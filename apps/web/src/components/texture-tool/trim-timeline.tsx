"use client";

import { ChevronLeft, ChevronRight, Crosshair, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { safeDrawImage } from "~/lib/sl/image";
import { cn } from "~/lib/utils";

export interface TimelineThumb {
  time: number;
  bitmap: ImageBitmap;
}

type Range = [number, number];
type Drag = "start" | "end" | "region" | "pan" | null;

const PRESETS = [0.5, 1, 1.8, 2, 3.5];
const FILM_COUNT = 16;

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return "0.00s";
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toFixed(2).padStart(5, "0")}`;
  }
  return `${sec.toFixed(2)}s`;
}

// Draws a bitmap at its intrinsic size; CSS object-cover crops it to the cell.
function FilmCell({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || bitmap.width === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    safeDrawImage(ctx, bitmap, 0, 0);
  }, [bitmap]);
  return (
    <div className="min-w-0 flex-1 overflow-hidden border-border/40 not-last:border-r">
      <canvas ref={ref} className="block h-full w-full object-cover" />
    </div>
  );
}

function ScrubPreview({ bitmap }: { bitmap: ImageBitmap | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !bitmap || bitmap.width === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    safeDrawImage(ctx, bitmap, 0, 0);
  }, [bitmap]);
  if (!bitmap) return null;
  return <canvas ref={ref} className="block h-full w-auto" />;
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
  durationSec: number;
  thumbs: TimelineThumb[];
  value: Range;
  frameStep: number;
  /** Live update during a drag (cheap visuals only). */
  onChange: (value: Range) => void;
  /** Committed update (drag release, nudge, type, click) — triggers re-render. */
  onCommit: (value: Range) => void;
  requestFrame?: (timeSec: number) => Promise<ImageBitmap | null>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const [scrub, setScrub] = useState<ImageBitmap | null>(null);

  const dur = durationSec > 0 ? durationSec : 1;
  const gap = Math.max(frameStep, dur / 5000);

  // Visible window of the timeline; reset to the whole clip on a new source.
  const [view, setView] = useState<Range>([0, dur]);
  useEffect(() => {
    setView([0, durationSec > 0 ? durationSec : 1]);
  }, [durationSec]);
  const [vStart, vEnd] = view;
  const viewLen = Math.max(gap, vEnd - vStart);
  const zoomed = viewLen < dur - 1e-3;

  const valueRef = useRef(value);
  valueRef.current = value;
  const viewRef = useRef(view);
  viewRef.current = view;
  const regionRef = useRef<{ at: number; range: Range }>({ at: 0, range: [0, 0] });
  const panRef = useRef<{ at: number; start: number }>({ at: 0, start: 0 });

  const pct = (t: number) => ((t - vStart) / viewLen) * 100;

  const timeFromTrackX = useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const [s, e] = viewRef.current;
    return s + f * (e - s);
  }, []);

  const timeFromMiniX = useCallback(
    (clientX: number) => {
      const rect = miniRef.current?.getBoundingClientRect();
      if (!rect) return 0;
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return f * dur;
    },
    [dur],
  );

  const withHandle = useCallback(
    (handle: "start" | "end", time: number): Range => {
      const t = Math.min(dur, Math.max(0, time));
      const [s, e] = valueRef.current;
      return handle === "start" ? [Math.min(t, e - gap), e] : [s, Math.max(t, s + gap)];
    },
    [dur, gap],
  );

  const withRegion = useCallback(
    (time: number): Range => {
      const { at, range } = regionRef.current;
      const len = range[1] - range[0];
      const ns = Math.min(dur - len, Math.max(0, range[0] + (time - at)));
      return [ns, ns + len];
    },
    [dur],
  );

  // --- Zoom / pan -----------------------------------------------------------
  const clampView = useCallback(
    (start: number, len: number): Range => {
      const l = Math.min(dur, Math.max(gap * 4, len));
      const s = Math.min(dur - l, Math.max(0, start));
      return [s, s + l];
    },
    [dur, gap],
  );

  const zoomAround = useCallback(
    (centerTime: number, factor: number) => {
      const [s, e] = viewRef.current;
      const len = e - s;
      const nl = Math.min(dur, Math.max(gap * 4, len * factor));
      const f = len > 0 ? (centerTime - s) / len : 0.5;
      setView(clampView(centerTime - f * nl, nl));
    },
    [clampView, dur, gap],
  );

  const zoomToSelection = useCallback(() => {
    const [s, e] = valueRef.current;
    const pad = Math.max((e - s) * 0.6, gap * 8);
    setView(clampView(s - pad, e - s + pad * 2));
  }, [clampView, gap]);

  const fitWhole = useCallback(() => setView([0, dur]), [dur]);

  // Native (non-passive) wheel so preventDefault reliably stops page scroll.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Proportional to scroll delta, clamped so a single notch / trackpad
      // burst can't leap; > 1 zooms out, < 1 zooms in.
      const factor = Math.min(1.25, Math.max(0.8, Math.exp(e.deltaY * 0.0015)));
      zoomAround(timeFromTrackX(e.clientX), factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround, timeFromTrackX]);

  // --- Scrub (throttled) ----------------------------------------------------
  const inFlight = useRef(false);
  const queued = useRef<number | null>(null);
  const scrubRef = useRef<ImageBitmap | null>(null);
  useEffect(
    () => () => {
      scrubRef.current?.close();
      scrubRef.current = null;
    },
    [],
  );
  const runScrub = useCallback(
    (time: number) => {
      if (!requestFrame) return;
      if (inFlight.current) {
        queued.current = time;
        return;
      }
      inFlight.current = true;
      requestFrame(time)
        .then((bmp) => {
          if (bmp) {
            scrubRef.current?.close();
            scrubRef.current = bmp;
            setScrub(bmp);
          }
        })
        .finally(() => {
          inFlight.current = false;
          if (queued.current !== null) {
            const next = queued.current;
            queued.current = null;
            runScrub(next);
          }
        });
    },
    [requestFrame],
  );

  // --- Zoomed filmstrip: decode frames across the visible window ------------
  const [viewThumbs, setViewThumbs] = useState<ImageBitmap[]>([]);
  const viewThumbsRef = useRef<ImageBitmap[]>([]);
  useEffect(
    () => () => {
      for (const b of viewThumbsRef.current) b.close();
      viewThumbsRef.current = [];
    },
    [],
  );
  useEffect(() => {
    if (!requestFrame || !zoomed) {
      if (viewThumbsRef.current.length) {
        for (const b of viewThumbsRef.current) b.close();
        viewThumbsRef.current = [];
        setViewThumbs([]);
      }
      return;
    }
    // Poll the current view (read from a ref) and re-decode only when it has
    // moved. This keeps the strip refreshing *while* panning, unlike a debounce
    // that waits for the pan to stop. The in-flight guard avoids piling up.
    let cancelled = false;
    let busy = false;
    let lastKey = "";
    const decode = async () => {
      if (busy) return;
      const [s, e] = viewRef.current;
      const key = `${s.toFixed(3)}_${e.toFixed(3)}`;
      if (key === lastKey) return;
      busy = true;
      lastKey = key;
      try {
        const len = e - s;
        const times = Array.from(
          { length: FILM_COUNT },
          (_, i) => s + ((i + 0.5) / FILM_COUNT) * len,
        );
        const decoded = await Promise.all(times.map((t) => requestFrame(t)));
        const bitmaps = decoded.filter((b): b is ImageBitmap => !!b);
        if (cancelled) {
          for (const b of bitmaps) b.close();
          return;
        }
        for (const b of viewThumbsRef.current) b.close();
        viewThumbsRef.current = bitmaps;
        setViewThumbs(bitmaps);
      } finally {
        busy = false;
      }
    };
    decode();
    const interval = window.setInterval(decode, 100);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [requestFrame, zoomed]);

  // --- Pointer drag (handles / region / minimap pan) ------------------------
  const pointerXRef = useRef(0);
  useEffect(() => {
    if (!drag) return;
    const apply = () => {
      const t = timeFromTrackX(pointerXRef.current);
      if (drag === "region") onChange(withRegion(t));
      else if (drag === "start" || drag === "end") onChange(withHandle(drag, t));
    };
    const onMove = (e: PointerEvent) => {
      pointerXRef.current = e.clientX;
      if (drag === "pan") {
        const t = timeFromMiniX(e.clientX);
        const len = viewRef.current[1] - viewRef.current[0];
        setView(clampView(panRef.current.start + (t - panRef.current.at), len));
        return;
      }
      apply();
    };
    const onUp = () => {
      if (drag !== "pan") onCommit(valueRef.current);
      setDrag(null);
    };

    // Auto-pan the view when a handle/region drag reaches a track edge.
    let raf = 0;
    const tick = () => {
      if (drag !== "pan") {
        const rect = trackRef.current?.getBoundingClientRect();
        const [s, e] = viewRef.current;
        if (rect) {
          const edge = 28;
          const x = pointerXRef.current;
          let dir = 0;
          let depth = 0;
          if (x < rect.left + edge && s > 0) {
            dir = -1;
            depth = rect.left + edge - x;
          } else if (x > rect.right - edge && e < dur) {
            dir = 1;
            depth = x - (rect.right - edge);
          }
          if (dir !== 0) {
            const len = e - s;
            setView(clampView(s + dir * Math.min(1, depth / edge) * len * 0.05, len));
            apply();
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
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
  ]);

  const nudge = (handle: "start" | "end", dir: -1 | 1, big = false) => {
    const step = big ? frameStep * 10 : frameStep;
    const cur = handle === "start" ? value[0] : value[1];
    onCommit(withHandle(handle, cur + dir * step));
  };

  const applyPreset = (len: number) => {
    const start = Math.min(value[0], Math.max(0, dur - len));
    onCommit([start, Math.min(dur, start + len)]);
    setView(clampView(start - len * 2.5, len * 6));
  };

  const startPct = pct(value[0]);
  const endPct = pct(value[1]);
  const filmstrip: ImageBitmap[] = zoomed ? viewThumbs : thumbs.map((t) => t.bitmap);

  return (
    <div className="flex flex-col gap-2">
      {/* Loop presets + zoom controls */}
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

      {/* Main (zoomable) track */}
      <div className="relative">
        {hover && !drag && (
          <div
            className="pointer-events-none absolute bottom-full z-30 mb-1.5 flex -translate-x-1/2 flex-col items-center gap-0.5"
            style={{ left: hover.x }}
          >
            {scrub && (
              <div className="h-12 overflow-hidden rounded border bg-background shadow-lg">
                <ScrubPreview bitmap={scrub} />
              </div>
            )}
            <span className="rounded bg-foreground px-1 py-0.5 font-mono text-[0.6rem] text-background">
              {formatTime(hover.time)}
            </span>
          </div>
        )}
        <div
          ref={trackRef}
          className="relative h-16 overflow-hidden rounded-md border select-none"
          onPointerDown={(e) => {
            // Clicking the track moves the whole loop to be centred on the click,
            // then continues as a region drag.
            const t = timeFromTrackX(e.clientX);
            const len = value[1] - value[0];
            const ns = Math.min(dur - len, Math.max(0, t - len / 2));
            const next: Range = [ns, ns + len];
            onChange(next);
            regionRef.current = { at: t, range: next };
            setDrag("region");
          }}
          onPointerMove={(e) => {
            if (drag) return;
            const rect = trackRef.current?.getBoundingClientRect();
            const t = timeFromTrackX(e.clientX);
            setHover({ x: rect ? e.clientX - rect.left : 0, time: t });
            runScrub(t);
          }}
          onPointerLeave={() => setHover(null)}
        >
          {/* Filmstrip */}
          <div className="absolute inset-0 flex">
            {filmstrip.length === 0 ? (
              <div className="flex-1 bg-muted/40" />
            ) : (
              filmstrip.map((bmp, i) => <FilmCell key={i} bitmap={bmp} />)
            )}
          </div>

          {/* Dimmed regions outside the selection */}
          <div
            className="absolute inset-y-0 left-0 bg-background/70"
            style={{ width: `${Math.min(100, Math.max(0, startPct))}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-background/70"
            style={{ width: `${Math.min(100, Math.max(0, 100 - endPct))}%` }}
          />

          {/* Draggable selection region */}
          <div
            className="absolute inset-y-0 z-[5] cursor-grab active:cursor-grabbing"
            style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              regionRef.current = { at: timeFromTrackX(e.clientX), range: [value[0], value[1]] };
              setDrag("region");
            }}
          />

          {/* Selection border */}
          <div
            className="pointer-events-none absolute inset-y-0 z-[5] border-x-2 border-primary"
            style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
          />

          {/* Handles */}
          {(["start", "end"] as const).map((h) => {
            const p = h === "start" ? startPct : endPct;
            if (p < -2 || p > 102) return null;
            return (
              <button
                key={h}
                type="button"
                aria-label={`${h} handle`}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setDrag(h);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft") {
                    e.preventDefault();
                    nudge(h, -1, e.shiftKey);
                  } else if (e.key === "ArrowRight") {
                    e.preventDefault();
                    nudge(h, 1, e.shiftKey);
                  }
                }}
                className="absolute inset-y-0 z-10 flex w-4 -translate-x-1/2 cursor-ew-resize items-center justify-center"
                style={{ left: `${p}%` }}
              >
                <span className="h-8 w-1 rounded-full bg-primary shadow ring-1 ring-background" />
              </button>
            );
          })}

          {/* Hover cursor line */}
          {hover && !drag && (
            <div
              className="pointer-events-none absolute inset-y-0 z-20 w-px bg-foreground/70"
              style={{ left: hover.x }}
            />
          )}
        </div>
      </div>

      {/* Minimap (whole clip) — shown when zoomed in */}
      {zoomed && (
        <div
          ref={miniRef}
          className="relative h-3 cursor-pointer overflow-hidden rounded bg-muted/50"
          onPointerDown={(e) => {
            const t = timeFromMiniX(e.clientX);
            const len = vEnd - vStart;
            setView(clampView(t - len / 2, len));
            panRef.current = { at: t, start: t - len / 2 };
            setDrag("pan");
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

      {/* Precise controls */}
      <div className="flex items-center justify-between gap-2 text-xs">
        <HandleControls
          label="In"
          time={value[0]}
          onNudge={(d, big) => nudge("start", d, big)}
          onType={(t) => onCommit(withHandle("start", t))}
        />
        <span className="font-mono text-muted-foreground">
          {formatTime(value[1] - value[0])} loop
        </span>
        <HandleControls
          label="Out"
          time={value[1]}
          onNudge={(d, big) => nudge("end", d, big)}
          onType={(t) => onCommit(withHandle("end", t))}
        />
      </div>
    </div>
  );
}

function HandleControls({
  label,
  time,
  onNudge,
  onType,
}: {
  label: string;
  time: number;
  onNudge: (dir: -1 | 1, big: boolean) => void;
  onType: (time: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}</span>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={`Nudge ${label} back`}
        onClick={(e) => onNudge(-1, e.shiftKey)}
      >
        <ChevronLeft />
      </Button>
      <input
        type="number"
        value={Number(time.toFixed(2))}
        min={0}
        step={0.05}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onType(n);
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
        onClick={(e) => onNudge(1, e.shiftKey)}
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
