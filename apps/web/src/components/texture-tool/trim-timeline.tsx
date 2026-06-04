"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export interface TimelineThumb {
  time: number;
  bitmap: ImageBitmap;
}

type Range = [number, number];
type Handle = "start" | "end" | "region" | null;

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
    if (!canvas) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
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
    if (!canvas || !bitmap) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
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
  const [dragging, setDragging] = useState<Handle>(null);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const [scrub, setScrub] = useState<ImageBitmap | null>(null);

  const dur = durationSec > 0 ? durationSec : 1;
  const gap = Math.max(frameStep, dur / 1000);
  const startPct = (value[0] / dur) * 100;
  const endPct = (value[1] / dur) * 100;

  // Keep the latest value reachable from pointer-event callbacks.
  const valueRef = useRef(value);
  valueRef.current = value;
  // For region drags: pointer time + range captured at drag start.
  const regionRef = useRef<{ at: number; range: Range }>({ at: 0, range: [0, 0] });

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return 0;
      const rect = track.getBoundingClientRect();
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

  // Throttled hover scrub: one decode in flight, latest queued.
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

  // Drag handling via window listeners (start / end / region).
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      const t = timeFromClientX(e.clientX);
      onChange(dragging === "region" ? withRegion(t) : withHandle(dragging, t));
    };
    const onUp = () => {
      onCommit(valueRef.current);
      setDragging(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dragging, onChange, onCommit, timeFromClientX, withHandle, withRegion]);

  const nudge = (handle: "start" | "end", dir: -1 | 1, big = false) => {
    const step = big ? frameStep * 10 : frameStep;
    const cur = handle === "start" ? value[0] : value[1];
    onCommit(withHandle(handle, cur + dir * step));
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        {hover && !dragging && (
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
            // Background click: snap the nearest handle here, then drag it.
            const t = timeFromClientX(e.clientX);
            const handle = Math.abs(t - value[0]) <= Math.abs(t - value[1]) ? "start" : "end";
            onChange(withHandle(handle, t));
            setDragging(handle);
          }}
          onPointerMove={(e) => {
            if (dragging) return;
            const rect = trackRef.current?.getBoundingClientRect();
            setHover({ x: rect ? e.clientX - rect.left : 0, time: timeFromClientX(e.clientX) });
            runScrub(timeFromClientX(e.clientX));
          }}
          onPointerLeave={() => setHover(null)}
        >
          {/* Filmstrip */}
          <div className="absolute inset-0 flex">
            {thumbs.length === 0 ? (
              <div className="flex-1 bg-muted/40" />
            ) : (
              thumbs.map((t, i) => <FilmCell key={i} bitmap={t.bitmap} />)
            )}
          </div>

          {/* Dimmed regions outside the selection */}
          <div
            className="absolute inset-y-0 left-0 bg-background/70"
            style={{ width: `${Math.max(0, startPct)}%` }}
          />
          <div
            className="absolute inset-y-0 right-0 bg-background/70"
            style={{ width: `${Math.max(0, 100 - endPct)}%` }}
          />

          {/* Draggable selection region */}
          <div
            className="absolute inset-y-0 z-[5] cursor-grab active:cursor-grabbing"
            style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              regionRef.current = { at: timeFromClientX(e.clientX), range: [value[0], value[1]] };
              setDragging("region");
            }}
          />

          {/* Selection border */}
          <div
            className="pointer-events-none absolute inset-y-0 z-[5] border-x-2 border-primary"
            style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
          />

          {/* Handles */}
          {(["start", "end"] as const).map((h) => (
            <button
              key={h}
              type="button"
              aria-label={`${h} handle`}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setDragging(h);
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
              style={{ left: `${h === "start" ? startPct : endPct}%` }}
            >
              <span className="h-8 w-1 rounded-full bg-primary shadow ring-1 ring-background" />
            </button>
          ))}

          {/* Hover cursor line */}
          {hover && !dragging && (
            <div
              className="pointer-events-none absolute inset-y-0 z-20 w-px bg-foreground/70"
              style={{ left: hover.x }}
            />
          )}
        </div>
      </div>

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
