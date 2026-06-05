"use client"

import { Expand, LoaderCircle, Wand2 } from "lucide-react"
import { useEffect, useRef } from "react"

import { Button } from "~/components/ui/button"
import { CanvasBitmap } from "~/components/ui/canvas-bitmap"
import { Spinner } from "~/components/ui/spinner"
import { safeDrawImage } from "~/lib/sl/image"
import { checkerBg, cn, formatClock } from "~/lib/utils"

export function SeamFrame({
  bitmap,
  faceAspect,
  caption,
  className,
  fill,
}: {
  bitmap: ImageBitmap | null
  faceAspect: number
  caption?: string
  className?: string
  fill?: boolean
}) {
  return (
    <div
      className={cn("flex flex-col gap-1", fill ? "h-full" : `min-w-0 ${className ?? "flex-1"}`)}
    >
      <div
        className={cn("overflow-hidden rounded border", checkerBg(12), fill && "h-full w-auto")}
        style={{ aspectRatio: `${faceAspect > 0 ? faceAspect : 1}` }}
      >
        <CanvasBitmap bitmap={bitmap} className="h-full w-full object-cover" />
      </div>
      {caption && (
        <span className="text-center font-mono text-[0.65rem] text-muted-foreground">
          {caption}
        </span>
      )}
    </div>
  )
}

function SeamPlayer({
  frames,
  faceAspect,
  loading,
}: {
  frames: ImageBitmap[]
  faceAspect: number
  loading?: boolean
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current

    if (!canvas || frames.length === 0) {
      return
    }

    const ctx = canvas.getContext("2d")

    if (!ctx) {
      return
    }

    const frameCount = frames.length
    const edgeCount = Math.min(3, frameCount)
    const seq: number[] = []

    for (let index = edgeCount; index >= 1; index--) {
      seq.push(frameCount - index) // last edgeCount
    }

    for (let index = 0; index < edgeCount; index++) {
      seq.push(index) // first edgeCount
    }

    const unique = seq.filter((value, index) => seq.indexOf(value) === index)

    const draw = (frameIndex: number) => {
      const bitmap = frames[frameIndex]

      if (!bitmap || bitmap.width === 0) {
        return
      }

      canvas.width = bitmap.width
      canvas.height = bitmap.height
      safeDrawImage(ctx, bitmap, 0, 0)
    }

    let raf = 0
    let last = 0
    let pos = 0
    const interval = 180
    draw(unique[0])

    const tick = (now: number) => {
      if (last === 0) {
        last = now
      }

      if (now - last >= interval) {
        last = now
        pos = (pos + 1) % unique.length
        draw(unique[pos])
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    return () => cancelAnimationFrame(raf)
  }, [frames])

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div
        className={cn("relative overflow-hidden rounded border-2 border-primary/60", checkerBg(12))}
        style={{ aspectRatio: `${faceAspect > 0 ? faceAspect : 1}` }}
      >
        <canvas ref={ref} className="h-full w-full object-cover" />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/50">
            <Spinner />
          </div>
        )}
      </div>
      <span className="text-center text-[0.65rem] text-muted-foreground">seam loop</span>
    </div>
  )
}

export function LoopSeam({
  frames,
  inFrame,
  outFrame,
  startTime,
  endTime,
  faceAspect,
  loading,
  onAutoMatch,
  autoMatching,
  onExpand,
}: {
  frames: ImageBitmap[]
  inFrame?: ImageBitmap | null
  outFrame?: ImageBitmap | null
  startTime: number
  endTime: number
  faceAspect: number
  loading?: boolean
  onAutoMatch: () => void
  autoMatching: boolean
  onExpand?: () => void
}) {
  const first = inFrame ?? frames[0] ?? null
  const last = outFrame ?? frames.at(-1) ?? null

  return (
    <div className="flex flex-col gap-2">
      <div className="group/seam relative flex items-start gap-2">
        <SeamFrame
          bitmap={first}
          faceAspect={faceAspect}
          caption={`in · ${formatClock(startTime, 2)}`}
        />
        <SeamPlayer frames={frames} faceAspect={faceAspect} loading={loading} />
        <SeamFrame
          bitmap={last}
          faceAspect={faceAspect}
          caption={`out · ${formatClock(endTime, 2)}`}
        />
        {onExpand && (
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="Expand loop view"
            onClick={onExpand}
            className="absolute top-1 right-1 opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover/seam:opacity-100"
          >
            <Expand />
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.7rem] text-muted-foreground">
          Match the last and first frames for a seamless loop, or enable ping-pong
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onAutoMatch}
          disabled={autoMatching || frames.length < 2}
          className="shrink-0"
        >
          {autoMatching ? <LoaderCircle className="animate-spin" /> : <Wand2 />}
          Auto-match
        </Button>
      </div>
    </div>
  )
}
