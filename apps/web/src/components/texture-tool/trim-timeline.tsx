"use client"

import { ChevronLeft, ChevronRight, Crosshair, Maximize2, ZoomIn, ZoomOut } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { useSnapshot } from "valtio"

import { Button } from "~/components/ui/button"
import { CanvasBitmap } from "~/components/ui/canvas-bitmap"
import { cn, formatClock } from "~/lib/utils"

import { ui } from "./store"

export interface TimelineThumb {
  time: number
  bitmap: ImageBitmap
}

type Range = [number, number]
type Drag = "start" | "end" | "region" | "pan" | null

const PRESETS = [0.5, 1, 1.8, 2, 3.5]
const FILM_COUNT = 16

// Every preset zooms to the same (widest) level, and only if the user hasn't
// touched the zoom in the last RECENT_ZOOM_MS, so rapid preset switching keeps
// a stable view instead of re-zooming on each click.
const PRESET_ZOOM_LEN = Math.max(...PRESETS)
const RECENT_ZOOM_MS = 5000

function FilmCell({ bitmap }: { bitmap: ImageBitmap }) {
  return (
    <div className="min-w-0 flex-1 overflow-hidden border-border/40 not-last:border-r">
      <CanvasBitmap bitmap={bitmap} className="block h-full w-full object-cover" />
    </div>
  )
}

export function TrimTimeline({
  durationSec,
  thumbs,
  value,
  frameStep,
  onChange,
  onCommit,
  requestFrame,
}: {
  durationSec: number
  thumbs: TimelineThumb[]
  value: Range
  frameStep: number
  onChange: (value: Range) => void
  onCommit: (value: Range) => void
  requestFrame?: (timeSec: number) => Promise<ImageBitmap | null>
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const miniRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag>(null)
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null)
  const [scrub, setScrub] = useState<ImageBitmap | null>(null)

  const dur = durationSec > 0 ? durationSec : 1
  const gap = Math.max(frameStep, dur / 5000)

  const view = useSnapshot(ui).view
  const lastZoomChange = useRef(0)

  const setView = (next: Range) => {
    if (Math.abs(next[1] - next[0] - (ui.view[1] - ui.view[0])) > 1e-3) {
      lastZoomChange.current = Date.now()
    }

    ui.view = next
  }

  const [vStart, vEnd] = view
  const viewLen = Math.max(gap, vEnd - vStart)
  const zoomed = viewLen < dur - 1e-3

  const valueRef = useRef(value)
  valueRef.current = value
  const regionRef = useRef<{ at: number; range: Range }>({ at: 0, range: [0, 0] })
  const panRef = useRef<{ at: number; start: number }>({ at: 0, start: 0 })

  const pct = (time: number) => ((time - vStart) / viewLen) * 100

  const timeFromTrackX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()

    if (!rect) {
      return 0
    }

    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const [start, end] = ui.view

    return start + fraction * (end - start)
  }, [])

  const timeFromMiniX = useCallback(
    (clientX: number) => {
      const rect = miniRef.current?.getBoundingClientRect()

      if (!rect) {
        return 0
      }

      const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))

      return fraction * dur
    },
    [dur],
  )

  const withHandle = useCallback(
    (handle: "start" | "end", time: number): Range => {
      const clamped = Math.min(dur, Math.max(0, time))
      const [start, end] = valueRef.current

      return handle === "start"
        ? [Math.min(clamped, end - gap), end]
        : [start, Math.max(clamped, start + gap)]
    },
    [dur, gap],
  )

  const withRegion = useCallback(
    (time: number): Range => {
      const { at, range } = regionRef.current
      const len = range[1] - range[0]
      const nextStart = Math.min(dur - len, Math.max(0, range[0] + (time - at)))

      return [nextStart, nextStart + len]
    },
    [dur],
  )

  const clampView = useCallback(
    (start: number, len: number): Range => {
      const length = Math.min(dur, Math.max(gap * 4, len))
      const clampedStart = Math.min(dur - length, Math.max(0, start))

      return [clampedStart, clampedStart + length]
    },
    [dur, gap],
  )

  const zoomAround = useCallback(
    (centerTime: number, factor: number) => {
      const [start, end] = ui.view
      const len = end - start
      const nextLength = Math.min(dur, Math.max(gap * 4, len * factor))
      const fraction = len > 0 ? (centerTime - start) / len : 0.5
      setView(clampView(centerTime - fraction * nextLength, nextLength))
    },
    [clampView, dur, gap],
  )

  const zoomToSelectionCenter = useCallback(
    (factor: number) => {
      const [start, end] = ui.view
      const len = end - start
      const nextLength = Math.min(dur, Math.max(gap * 4, len * factor))
      const [valueStart, valueEnd] = valueRef.current
      const mid = (valueStart + valueEnd) / 2
      setView(clampView(mid - nextLength / 2, nextLength))
    },
    [clampView, dur, gap],
  )

  const panView = useCallback(
    (deltaTime: number) => {
      const [start, end] = ui.view
      setView(clampView(start + deltaTime, end - start))
    },
    [clampView],
  )

  const zoomToSelection = useCallback(() => {
    const [start, end] = valueRef.current
    const pad = Math.max((end - start) * 0.6, gap * 8)
    setView(clampView(start - pad, end - start + pad * 2))
  }, [clampView, gap])

  const fitWhole = useCallback(() => setView([0, dur]), [dur])

  useEffect(() => {
    const element = trackRef.current

    if (!element) {
      return
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const horizontal = event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)

      if (horizontal) {
        const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
        const rect = element.getBoundingClientRect()
        const len = ui.view[1] - ui.view[0]
        panView((delta / rect.width) * len)
      } else {
        const factor = Math.min(1.25, Math.max(0.8, Math.exp(event.deltaY * 0.0015)))
        zoomToSelectionCenter(factor)
      }
    }

    element.addEventListener("wheel", onWheel, { passive: false })

    return () => element.removeEventListener("wheel", onWheel)
  }, [zoomToSelectionCenter, panView])

  const inFlight = useRef(false)
  const queued = useRef<number | null>(null)
  const scrubRef = useRef<ImageBitmap | null>(null)

  useEffect(
    () => () => {
      scrubRef.current?.close()
      scrubRef.current = null
    },
    [],
  )

  const runScrub = useCallback(
    (time: number) => {
      if (!requestFrame) {
        return
      }

      if (inFlight.current) {
        queued.current = time
        return
      }

      inFlight.current = true

      requestFrame(time)
        .then((bitmap) => {
          if (bitmap) {
            scrubRef.current?.close()
            scrubRef.current = bitmap
            setScrub(bitmap)
          }
        })
        .finally(() => {
          inFlight.current = false

          if (queued.current !== null) {
            const next = queued.current
            queued.current = null
            runScrub(next)
          }
        })
    },
    [requestFrame],
  )

  const [viewThumbs, setViewThumbs] = useState<ImageBitmap[]>([])
  const viewThumbsRef = useRef<ImageBitmap[]>([])

  useEffect(
    () => () => {
      for (const bitmap of viewThumbsRef.current) {
        bitmap.close()
      }

      viewThumbsRef.current = []
    },
    [],
  )

  useEffect(() => {
    if (!requestFrame || !zoomed) {
      if (viewThumbsRef.current.length) {
        for (const bitmap of viewThumbsRef.current) {
          bitmap.close()
        }

        viewThumbsRef.current = []
        setViewThumbs([])
      }

      return
    }
    // Poll the current view (read from the store) and re-decode only when it has
    // moved. This keeps the strip refreshing *while* panning, unlike a debounce
    // that waits for the pan to stop. The `busy` guard avoids piling up decodes.
    let cancelled = false
    let busy = false
    let lastKey = ""

    const decode = async () => {
      if (busy) {
        return
      }

      const [start, end] = ui.view
      const key = `${start.toFixed(3)}_${end.toFixed(3)}`

      if (key === lastKey) {
        return
      }

      busy = true
      lastKey = key

      try {
        const len = end - start
        const times = Array.from(
          { length: FILM_COUNT },
          (_, index) => start + ((index + 0.5) / FILM_COUNT) * len,
        )
        const decoded = await Promise.all(times.map((time) => requestFrame(time)))
        const bitmaps = decoded.filter((bitmap): bitmap is ImageBitmap => !!bitmap)

        if (cancelled) {
          for (const bitmap of bitmaps) {
            bitmap.close()
          }

          return
        }

        for (const bitmap of viewThumbsRef.current) {
          bitmap.close()
        }

        viewThumbsRef.current = bitmaps
        setViewThumbs(bitmaps)
      } finally {
        busy = false
      }
    }

    decode()
    const interval = window.setInterval(decode, 100)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [requestFrame, zoomed])

  const pointerXRef = useRef(0)

  useEffect(() => {
    if (!drag) {
      return
    }

    const apply = () => {
      const time = timeFromTrackX(pointerXRef.current)

      if (drag === "region") {
        onChange(withRegion(time))
      } else if (drag === "start" || drag === "end") {
        onChange(withHandle(drag, time))
      }
    }

    const onMove = (event: PointerEvent) => {
      pointerXRef.current = event.clientX

      if (drag === "pan") {
        const time = timeFromMiniX(event.clientX)
        const len = ui.view[1] - ui.view[0]
        setView(clampView(panRef.current.start + (time - panRef.current.at), len))
        return
      }

      apply()
    }

    const onUp = () => {
      if (drag !== "pan") {
        onCommit(valueRef.current)
      }

      setDrag(null)
    }

    let raf = 0

    const tick = () => {
      if (drag !== "pan") {
        const rect = trackRef.current?.getBoundingClientRect()
        const [start, end] = ui.view

        if (rect) {
          const edge = 28
          const pointerX = pointerXRef.current
          let dir = 0
          let depth = 0

          if (pointerX < rect.left + edge && start > 0) {
            dir = -1
            depth = rect.left + edge - pointerX
          } else if (pointerX > rect.right - edge && end < dur) {
            dir = 1
            depth = pointerX - (rect.right - edge)
          }

          if (dir !== 0) {
            const len = end - start
            setView(clampView(start + dir * Math.min(1, depth / edge) * len * 0.05, len))
            apply()
          }
        }
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [
    drag,
    onChange,
    onCommit,
    timeFromTrackX,
    timeFromMiniX,
    withHandle,
    withRegion,
    clampView,
    dur,
  ])

  const nudge = (handle: "start" | "end", dir: -1 | 1, big = false) => {
    const step = big ? frameStep * 10 : frameStep
    const cur = handle === "start" ? value[0] : value[1]
    onCommit(withHandle(handle, cur + dir * step))
  }

  const applyPreset = (len: number) => {
    const start = Math.min(value[0], Math.max(0, dur - len))
    onCommit([start, Math.min(dur, start + len)])
    const now = Date.now()

    if (now - lastZoomChange.current >= RECENT_ZOOM_MS) {
      const zoomLen = PRESET_ZOOM_LEN
      setView(clampView(start - zoomLen * 2.5, zoomLen * 6))
    }

    lastZoomChange.current = now
  }

  const startPct = pct(value[0])
  const endPct = pct(value[1])
  const filmstrip: ImageBitmap[] = zoomed ? viewThumbs : thumbs.map((thumb) => thumb.bitmap)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <span className="text-[0.7rem] text-muted-foreground">Loop</span>
          {PRESETS.map((len) => (
            <Button
              key={len}
              variant="outline"
              size="xs"
              onClick={() => applyPreset(len)}
              disabled={len > dur}
            >
              {len}s
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom to loop"
            onClick={zoomToSelection}
          >
            <Crosshair />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom out"
            onClick={() => zoomAround((vStart + vEnd) / 2, 1.5)}
            disabled={!zoomed}
          >
            <ZoomOut />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom in"
            onClick={() => zoomAround((vStart + vEnd) / 2, 1 / 1.5)}
          >
            <ZoomIn />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Fit whole clip"
            onClick={fitWhole}
            disabled={!zoomed}
          >
            <Maximize2 />
          </Button>
        </div>
      </div>

      <div className="relative">
        {hover && !drag && (
          <div
            className="pointer-events-none absolute bottom-full z-30 mb-1.5 flex -translate-x-1/2 flex-col items-center gap-0.5"
            style={{ left: hover.x }}
          >
            {scrub && (
              <div className="h-12 overflow-hidden rounded border bg-background shadow-lg">
                <CanvasBitmap bitmap={scrub} className="block h-full w-auto" />
              </div>
            )}
            <span className="rounded bg-foreground px-1 py-0.5 font-mono text-[0.6rem] text-background">
              {formatClock(hover.time, 2)}
            </span>
          </div>
        )}
        <div
          ref={trackRef}
          className="relative h-16 overflow-hidden rounded-md border select-none"
          onPointerDown={(event) => {
            const time = timeFromTrackX(event.clientX)
            const len = value[1] - value[0]
            const nextStart = Math.min(dur - len, Math.max(0, time - len / 2))
            const next: Range = [nextStart, nextStart + len]
            onChange(next)
            regionRef.current = { at: time, range: next }
            setDrag("region")
          }}
          onPointerMove={(event) => {
            if (drag) {
              return
            }

            const rect = trackRef.current?.getBoundingClientRect()
            const time = timeFromTrackX(event.clientX)
            setHover({ x: rect ? event.clientX - rect.left : 0, time })
            runScrub(time)
          }}
          onPointerLeave={() => setHover(null)}
        >
          <div className="absolute inset-0 flex">
            {filmstrip.length === 0 ? (
              <div className="flex-1 bg-muted/40" />
            ) : (
              filmstrip.map((bitmap, index) => <FilmCell key={index} bitmap={bitmap} />)
            )}
          </div>

          <div
            className="absolute inset-y-0 left-0 bg-background/70"
            style={{ width: `${Math.min(100, Math.max(0, startPct))}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-background/70"
            style={{ width: `${Math.min(100, Math.max(0, 100 - endPct))}%` }}
          />

          <div
            className="absolute inset-y-0 z-[5] cursor-grab active:cursor-grabbing"
            style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
            onPointerDown={(event) => {
              event.stopPropagation()
              regionRef.current = {
                at: timeFromTrackX(event.clientX),
                range: [value[0], value[1]],
              }
              setDrag("region")
            }}
          />

          <div
            className="pointer-events-none absolute inset-y-0 z-[5] border-x-2 border-primary"
            style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
          />

          {(["start", "end"] as const).map((handle) => {
            const position = handle === "start" ? startPct : endPct

            if (position < -2 || position > 102) {
              return null
            }

            return (
              <button
                key={handle}
                type="button"
                aria-label={`${handle} handle`}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  event.preventDefault()
                  setDrag(handle)
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowLeft") {
                    event.preventDefault()
                    nudge(handle, -1, event.shiftKey)
                  } else if (event.key === "ArrowRight") {
                    event.preventDefault()
                    nudge(handle, 1, event.shiftKey)
                  }
                }}
                className="absolute inset-y-0 z-10 flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center"
                style={{ left: `${position}%` }}
              >
                <span className="h-8 w-1 rounded-full bg-primary shadow ring-1 ring-background" />
              </button>
            )
          })}

          {hover && !drag && (
            <div
              className="pointer-events-none absolute inset-y-0 z-20 w-px bg-foreground/70"
              style={{ left: hover.x }}
            />
          )}
        </div>
      </div>

      {zoomed && (
        <div
          ref={miniRef}
          className="relative h-3 cursor-pointer overflow-hidden rounded bg-muted/50"
          onPointerDown={(event) => {
            const time = timeFromMiniX(event.clientX)
            const len = vEnd - vStart
            setView(clampView(time - len / 2, len))
            panRef.current = { at: time, start: time - len / 2 }
            setDrag("pan")
          }}
        >
          <div
            className="absolute inset-y-0 bg-primary/30"
            style={{
              left: `${(value[0] / dur) * 100}%`,
              right: `${100 - (value[1] / dur) * 100}%`,
            }}
          />
          <div
            className="absolute inset-y-0 rounded-sm border border-foreground/60 bg-foreground/10"
            style={{ left: `${(vStart / dur) * 100}%`, right: `${100 - (vEnd / dur) * 100}%` }}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-xs">
        <HandleControls
          label="In"
          time={value[0]}
          frameStep={frameStep}
          onNudge={(dir, big) => nudge("start", dir, big)}
          onType={(time) => onCommit(withHandle("start", time))}
        />
        <span className="font-mono text-muted-foreground">
          {formatClock(value[1] - value[0], 2)} loop
        </span>
        <HandleControls
          label="Out"
          time={value[1]}
          frameStep={frameStep}
          onNudge={(dir, big) => nudge("end", dir, big)}
          onType={(time) => onCommit(withHandle("end", time))}
        />
      </div>
    </div>
  )
}

function HandleControls({
  label,
  time,
  frameStep,
  onNudge,
  onType,
}: {
  label: string
  time: number
  frameStep: number
  onNudge: (dir: -1 | 1, big: boolean) => void
  onType: (time: number) => void
}) {
  const step = frameStep > 0 ? frameStep : 1 / 30
  const frame = Math.round(time / step)

  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Nudge ${label} back`}
        onClick={(event) => onNudge(-1, event.shiftKey)}
      >
        <ChevronLeft />
      </Button>
      <input
        type="number"
        value={frame}
        min={0}
        step={1}
        onChange={(event) => {
          const value = Number(event.target.value)

          if (!Number.isNaN(value)) {
            onType(value * step)
          }
        }}
        className={cn(
          "w-16 rounded bg-transparent text-center font-mono tabular-nums outline-none",
          "focus:text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none",
        )}
      />
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Nudge ${label} forward`}
        onClick={(event) => onNudge(1, event.shiftKey)}
      >
        <ChevronRight />
      </Button>
    </div>
  )
}
