import { useCallback, useState } from "react";
import { toast } from "sonner";

import { downscaleData } from "~/lib/sl/image";
import type { FrameSampler } from "~/lib/sl/extract";
import { settings, ui } from "~/components/texture-tool/store";

const FRAME_BUDGET = 144;
const MIN_LOOP_SEC = 2;
const MAX_LOOP_SEC = 5;
const DECODE_SIZE = 64;
const COMPARE_SIZE = 48;
const MAX_SAMPLES = 160;
const MOTION_WEIGHT = 1;
const SEAM_THRESHOLD = 0.25;
const START_RANGE = 2;
const START_BIAS = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function luma(data: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(data.length >> 2);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

function meanSub(src: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < src.length; i++) sum += src[i];
  const mean = sum / src.length;
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] - mean;
  return out;
}

function structuralDiff(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum;
}

function seamCost(
  endNorm: Float32Array,
  startNorm: Float32Array,
  endRaw: Float32Array,
  prevRaw: Float32Array,
  motionRef: Float32Array,
): number {
  let motion = 0;
  for (let i = 0; i < endRaw.length; i++) {
    motion += Math.abs(endRaw[i] - prevRaw[i] - motionRef[i]);
  }
  return structuralDiff(endNorm, startNorm) + MOTION_WEIGHT * motion;
}

function pickSeam(cost: number[]): { idx: number; cost: number } | null {
  let cMin = Infinity;
  let cMax = -Infinity;
  for (const c of cost) {
    if (!Number.isFinite(c)) continue;
    if (c < cMin) cMin = c;
    if (c > cMax) cMax = c;
  }
  if (!Number.isFinite(cMin)) return null;
  const span = Math.max(1e-6, cMax - cMin);

  for (let i = 0; i < cost.length; i++) {
    if (!Number.isFinite(cost[i])) continue;
    const left = i > 0 ? cost[i - 1] : Infinity;
    const right = i < cost.length - 1 ? cost[i + 1] : Infinity;
    if (cost[i] <= left && cost[i] <= right && (cost[i] - cMin) / span < SEAM_THRESHOLD) {
      return { idx: i, cost: cost[i] };
    }
  }

  let idx = -1;
  let best = Infinity;
  for (let i = 0; i < cost.length; i++) {
    if (Number.isFinite(cost[i]) && cost[i] < best) {
      best = cost[i];
      idx = i;
    }
  }
  return idx < 0 ? null : { idx, cost: best };
}

export function useAutoMatch({
  sampler,
  durationSec,
  frameStep,
  framesLength,
  fps,
}: {
  sampler: FrameSampler | null;
  durationSec: number;
  frameStep: number;
  framesLength: number;
  fps: number;
}) {
  const [autoMatching, setAutoMatching] = useState(false);

  const handleAutoMatch = useCallback(async () => {
    if (!sampler || durationSec <= 0 || framesLength < 2) return;
    setAutoMatching(true);
    try {
      const startT = ui.trim[0];
      const effFps = fps > 0 ? fps : 30;
      const maxLoopSec = clamp(FRAME_BUDGET / effFps, MIN_LOOP_SEC, MAX_LOOP_SEC);

      const minLen = Math.max(0.4, frameStep * 6);
      const lo = startT + minLen;
      const hi = Math.min(durationSec, startT + maxLoopSec);

      if (hi - startT <= minLen + frameStep) {
        const matched: [number, number] = [startT, hi];
        ui.trim = matched;
        settings.committedTrim = matched;
        return;
      }

      const gridCount = Math.round((hi - lo) / frameStep) + 1;
      const stride = Math.max(1, Math.ceil(gridCount / MAX_SAMPLES));
      const step = frameStep * stride;

      const candTimes: number[] = [];
      for (let t = lo; t <= hi + 1e-9; t += step) candTimes.push(Math.min(hi, t));

      const startCands: { time: number; offset: number }[] = [];
      for (let j = -START_RANGE; j <= START_RANGE; j++) {
        const s = startT + j * frameStep;
        if (s < 0 || hi - s <= minLen + frameStep) continue;
        startCands.push({ time: s, offset: Math.abs(j) });
      }
      if (!startCands.length) startCands.push({ time: startT, offset: 0 });

      const startTimes = startCands.flatMap((c) => [
        c.time,
        Math.min(durationSec, c.time + frameStep),
      ]);
      const times = [...startTimes, Math.max(0, lo - step), ...candTimes];

      const decoded = await sampler.sampleAtTimes(times, { maxDecodeSize: DECODE_SIZE });
      const raw = decoded.map((b) => luma(downscaleData(b, COMPARE_SIZE)));
      for (const b of decoded) b.close();
      const norm = raw.map(meanSub);

      const base = startTimes.length;
      const motionRef = new Float32Array(raw[0].length);

      let best: { start: number; end: number; cost: number } | null = null;
      for (let ci = 0; ci < startCands.length; ci++) {
        const { time: s, offset } = startCands[ci];
        const startRaw = raw[ci * 2];
        const startNorm = norm[ci * 2];
        const startNext = raw[ci * 2 + 1];
        for (let i = 0; i < motionRef.length; i++) motionRef[i] = startNext[i] - startRaw[i];

        const cost = candTimes.map((end, k) => {
          const len = end - s;
          if (len < minLen || len > maxLoopSec) return Infinity;
          return seamCost(
            norm[base + 1 + k],
            startNorm,
            raw[base + 1 + k],
            raw[base + k],
            motionRef,
          );
        });

        const pick = pickSeam(cost);
        if (!pick) continue;
        const penalized = pick.cost * (1 + START_BIAS * offset);
        if (best && penalized >= best.cost) continue;
        best = { start: s, end: candTimes[pick.idx], cost: penalized };
      }

      if (!best) {
        toast.error("Auto-match failed");
        return;
      }

      const matched: [number, number] = [best.start, clamp(best.end, best.start + minLen, hi)];
      ui.trim = matched;
      settings.committedTrim = matched;
    } catch {
      toast.error("Auto-match failed");
    } finally {
      setAutoMatching(false);
    }
  }, [sampler, durationSec, frameStep, framesLength, fps]);

  return { autoMatching, handleAutoMatch };
}
