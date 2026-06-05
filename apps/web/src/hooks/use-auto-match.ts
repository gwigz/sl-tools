import { useCallback, useState } from "react"
import { toast } from "sonner"

import { downscaleData } from "~/lib/sl/image"
import type { FrameSampler } from "~/lib/sl/extract"
import { settings, ui } from "~/components/texture-tool/store"

const FRAME_BUDGET = 144
const MIN_LOOP_SEC = 2
const MAX_LOOP_SEC = 5
const DECODE_SIZE = 64
const COMPARE_SIZE = 48
const MAX_SAMPLES = 160
const MOTION_WEIGHT = 1
const SEAM_THRESHOLD = 0.25
const START_RANGE = 2
const START_BIAS = 0.05

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))

function luma(data: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(data.length >> 2)

  for (let index = 0, outIndex = 0; index < data.length; index += 4, outIndex++) {
    out[outIndex] = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  }

  return out
}

function meanSub(src: Float32Array): Float32Array {
  let sum = 0

  for (let index = 0; index < src.length; index++) {
    sum += src[index]
  }

  const mean = sum / src.length
  const out = new Float32Array(src.length)

  for (let index = 0; index < src.length; index++) {
    out[index] = src[index] - mean
  }

  return out
}

function structuralDiff(first: Float32Array, second: Float32Array): number {
  let sum = 0

  for (let index = 0; index < first.length; index++) {
    sum += Math.abs(first[index] - second[index])
  }

  return sum
}

function seamCost(
  endNorm: Float32Array,
  startNorm: Float32Array,
  endRaw: Float32Array,
  prevRaw: Float32Array,
  motionRef: Float32Array,
): number {
  let motion = 0

  for (let index = 0; index < endRaw.length; index++) {
    motion += Math.abs(endRaw[index] - prevRaw[index] - motionRef[index])
  }

  return structuralDiff(endNorm, startNorm) + MOTION_WEIGHT * motion
}

function pickSeam(cost: number[]): { idx: number; cost: number } | null {
  let cMin = Infinity
  let cMax = -Infinity

  for (const value of cost) {
    if (!Number.isFinite(value)) {
      continue
    }

    if (value < cMin) {
      cMin = value
    }

    if (value > cMax) {
      cMax = value
    }
  }

  if (!Number.isFinite(cMin)) {
    return null
  }

  const span = Math.max(1e-6, cMax - cMin)

  for (let index = 0; index < cost.length; index++) {
    if (!Number.isFinite(cost[index])) {
      continue
    }

    const left = index > 0 ? cost[index - 1] : Infinity
    const right = index < cost.length - 1 ? cost[index + 1] : Infinity

    if (
      cost[index] <= left &&
      cost[index] <= right &&
      (cost[index] - cMin) / span < SEAM_THRESHOLD
    ) {
      return { idx: index, cost: cost[index] }
    }
  }

  let idx = -1
  let best = Infinity

  for (let index = 0; index < cost.length; index++) {
    if (Number.isFinite(cost[index]) && cost[index] < best) {
      best = cost[index]
      idx = index
    }
  }

  return idx < 0 ? null : { idx, cost: best }
}

export function useAutoMatch({
  sampler,
  durationSec,
  frameStep,
  framesLength,
  fps,
}: {
  sampler: FrameSampler | null
  durationSec: number
  frameStep: number
  framesLength: number
  fps: number
}) {
  const [autoMatching, setAutoMatching] = useState(false)

  const handleAutoMatch = useCallback(async () => {
    if (!sampler || durationSec <= 0 || framesLength < 2) {
      return
    }

    setAutoMatching(true)

    try {
      const startT = ui.trim[0]
      const effFps = fps > 0 ? fps : 30
      const maxLoopSec = clamp(FRAME_BUDGET / effFps, MIN_LOOP_SEC, MAX_LOOP_SEC)

      const minLen = Math.max(0.4, frameStep * 6)
      const low = startT + minLen
      const high = Math.min(durationSec, startT + maxLoopSec)

      if (high - startT <= minLen + frameStep) {
        const matched: [number, number] = [startT, high]
        ui.trim = matched
        settings.committedTrim = matched
        return
      }

      const gridCount = Math.round((high - low) / frameStep) + 1
      const stride = Math.max(1, Math.ceil(gridCount / MAX_SAMPLES))
      const step = frameStep * stride

      const candTimes: number[] = []

      for (let time = low; time <= high + 1e-9; time += step) {
        candTimes.push(Math.min(high, time))
      }

      const startCands: { time: number; offset: number }[] = []

      for (let stepOffset = -START_RANGE; stepOffset <= START_RANGE; stepOffset++) {
        const candidateStart = startT + stepOffset * frameStep

        if (candidateStart < 0 || high - candidateStart <= minLen + frameStep) {
          continue
        }

        startCands.push({ time: candidateStart, offset: Math.abs(stepOffset) })
      }

      if (!startCands.length) {
        startCands.push({ time: startT, offset: 0 })
      }

      const startTimes = startCands.flatMap((cand) => [
        cand.time,
        Math.min(durationSec, cand.time + frameStep),
      ])
      const times = [...startTimes, Math.max(0, low - step), ...candTimes]

      const decoded = await sampler.sampleAtTimes(times, { maxDecodeSize: DECODE_SIZE })
      const raw = decoded.map((bitmap) => luma(downscaleData(bitmap, COMPARE_SIZE)))

      for (const bitmap of decoded) {
        bitmap.close()
      }

      const norm = raw.map(meanSub)

      const base = startTimes.length
      const motionRef = new Float32Array(raw[0].length)

      let best: { start: number; end: number; cost: number } | null = null

      for (let candIndex = 0; candIndex < startCands.length; candIndex++) {
        const { time: candStart, offset } = startCands[candIndex]
        const startRaw = raw[candIndex * 2]
        const startNorm = norm[candIndex * 2]
        const startNext = raw[candIndex * 2 + 1]

        for (let index = 0; index < motionRef.length; index++) {
          motionRef[index] = startNext[index] - startRaw[index]
        }

        const cost = candTimes.map((end, index) => {
          const len = end - candStart

          if (len < minLen || len > maxLoopSec) {
            return Infinity
          }

          return seamCost(
            norm[base + 1 + index],
            startNorm,
            raw[base + 1 + index],
            raw[base + index],
            motionRef,
          )
        })

        const pick = pickSeam(cost)

        if (!pick) {
          continue
        }

        const penalized = pick.cost * (1 + START_BIAS * offset)

        if (best && penalized >= best.cost) {
          continue
        }

        best = { start: candStart, end: candTimes[pick.idx], cost: penalized }
      }

      if (!best) {
        toast.error("Auto-match failed")
        return
      }

      const matched: [number, number] = [best.start, clamp(best.end, best.start + minLen, high)]
      ui.trim = matched
      settings.committedTrim = matched
    } catch {
      toast.error("Auto-match failed")
    } finally {
      setAutoMatching(false)
    }
  }, [sampler, durationSec, frameStep, framesLength, fps])

  return { autoMatching, handleAutoMatch }
}
