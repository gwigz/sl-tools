"use client";

import { LoaderCircle, Wand2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "~/components/ui/button";

const CHECKER =
  "bg-[conic-gradient(#0000_90deg,#80808015_0_180deg,#0000_0_270deg,#80808015_0)] bg-[length:12px_12px]";

function fmt(sec: number): string {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toFixed(1).padStart(4, "0")}`;
  }
  return `${sec.toFixed(2)}s`;
}

function FrameBox({
  bitmap,
  faceAspect,
  caption,
}: {
  bitmap: ImageBitmap | null;
  faceAspect: number;
  caption: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !bitmap) return;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div
        className={`overflow-hidden rounded border ${CHECKER}`}
        style={{ aspectRatio: `${faceAspect > 0 ? faceAspect : 1}` }}
      >
        {bitmap && <canvas ref={ref} className="h-full w-full object-cover" />}
      </div>
      <span className="text-center font-mono text-[0.65rem] text-muted-foreground">{caption}</span>
    </div>
  );
}

// Slowly cycles the last few frames into the first few so the loop's wrap point
// can be scrutinised.
function SeamPlayer({ frames, faceAspect }: { frames: ImageBitmap[]; faceAspect: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || frames.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const n = frames.length;
    const k = Math.min(3, n);
    const seq: number[] = [];
    for (let i = k; i >= 1; i--) seq.push(n - i); // last k
    for (let i = 0; i < k; i++) seq.push(i); // first k
    const unique = seq.filter((v, i) => seq.indexOf(v) === i);

    const draw = (idx: number) => {
      const bmp = frames[idx];
      if (!bmp) return;
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      ctx.drawImage(bmp, 0, 0);
    };

    let raf = 0;
    let last = 0;
    let pos = 0;
    const interval = 180;
    draw(unique[0]);
    const tick = (now: number) => {
      if (last === 0) last = now;
      if (now - last >= interval) {
        last = now;
        pos = (pos + 1) % unique.length;
        draw(unique[pos]);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frames]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div
        className={`overflow-hidden rounded border-2 border-primary/60 ${CHECKER}`}
        style={{ aspectRatio: `${faceAspect > 0 ? faceAspect : 1}` }}
      >
        <canvas ref={ref} className="h-full w-full object-cover" />
      </div>
      <span className="text-center text-[0.65rem] text-muted-foreground">seam loop</span>
    </div>
  );
}

export function LoopSeam({
  frames,
  inFrame,
  outFrame,
  startTime,
  endTime,
  faceAspect,
  onAutoMatch,
  autoMatching,
}: {
  frames: ImageBitmap[];
  /** Live in/out frames at the current handles, decoded ahead of re-extraction. */
  inFrame?: ImageBitmap | null;
  outFrame?: ImageBitmap | null;
  startTime: number;
  endTime: number;
  faceAspect: number;
  onAutoMatch: () => void;
  autoMatching: boolean;
}) {
  const first = inFrame ?? frames[0] ?? null;
  const last = outFrame ?? frames.at(-1) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-2">
        <FrameBox bitmap={first} faceAspect={faceAspect} caption={`in · ${fmt(startTime)}`} />
        <SeamPlayer frames={frames} faceAspect={faceAspect} />
        <FrameBox bitmap={last} faceAspect={faceAspect} caption={`out · ${fmt(endTime)}`} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[0.7rem] text-muted-foreground">
          Match the last and first frames for a seamless loop, or enable Ping-Pong.
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
  );
}
