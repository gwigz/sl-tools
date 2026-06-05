"use client";

import { Expand } from "lucide-react";
import { useEffect, useRef } from "react";
import { useSnapshot } from "valtio";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { checkerBg, cn } from "~/lib/utils";

import { ui } from "./store";

type PlaybackProps = {
  sheet: HTMLCanvasElement | null;
  cols: number;
  rows: number;
  frameCount: number;
  fps: number;
  faceAspect: number;
  reverse: boolean;
  pingPong: boolean;
  loop: boolean;
};

function PlaybackCanvas({
  sheet,
  cols,
  rows,
  frameCount,
  fps,
  faceAspect,
  reverse,
  pingPong,
  loop,
  playing,
  className,
}: PlaybackProps & { playing: boolean; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const ar = faceAspect > 0 ? faceAspect : 1;
  const backingW = 720;
  const backingH = Math.round(backingW / ar);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sheet) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const total = Math.max(1, Math.min(frameCount, cols * rows));
    const cellW = sheet.width / cols;
    const cellH = sheet.height / rows;

    const draw = (frame: number) => {
      const idx = Math.min(total - 1, Math.max(0, frame));
      const sx = (idx % cols) * cellW;
      const sy = Math.floor(idx / cols) * cellH;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(sheet, sx, sy, cellW, cellH, 0, 0, canvas.width, canvas.height);
    };

    const start = reverse && !pingPong ? total - 1 : 0;

    if (!playing || total <= 1 || fps <= 0) {
      draw(start);
      return;
    }

    let raf = 0;
    let last = 0;
    let frame = start;
    let direction = reverse ? -1 : 1;
    const interval = 1000 / fps;

    const tick = (now: number) => {
      if (last === 0) last = now;
      if (now - last >= interval) {
        last = now;
        if (pingPong) {
          frame += direction;
          if (frame >= total - 1) {
            frame = total - 1;
            direction = -1;
          } else if (frame <= 0) {
            frame = 0;
            direction = 1;
          }
        } else if (reverse) {
          frame -= 1;
          if (frame < 0) frame = loop ? total - 1 : 0;
        } else {
          frame += 1;
          if (frame >= total) frame = loop ? 0 : total - 1;
        }
        draw(frame);
      }
      raf = requestAnimationFrame(tick);
    };
    draw(start);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [sheet, cols, rows, frameCount, fps, reverse, pingPong, loop, playing, backingW, backingH]);

  return (
    <canvas
      ref={canvasRef}
      width={backingW}
      height={backingH}
      className={cn(!sheet && "opacity-0", className)}
    />
  );
}

export function SlPreview({ controls, ...props }: PlaybackProps & { controls?: React.ReactNode }) {
  const { sheet, faceAspect } = props;
  const ar = faceAspect > 0 ? faceAspect : 1;
  const { previewOpen } = useSnapshot(ui);

  return (
    <div className="flex flex-col items-center gap-3">
      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          ui.previewOpen = open;
        }}
      >
        <div
          className={cn(
            "group/preview relative flex max-w-full items-center justify-center overflow-hidden rounded-md border",
            checkerBg(16),
          )}
          style={{ aspectRatio: `${ar}` }}
        >
          <PlaybackCanvas {...props} playing className="h-auto w-full max-w-[360px]" />
          {!sheet && <span className="absolute text-xs text-muted-foreground">No preview yet</span>}
          {sheet && (
            <Button
              variant="secondary"
              size="icon-sm"
              aria-label="Expand preview"
              onClick={() => {
                ui.previewOpen = true;
              }}
              className="absolute top-2 right-2 opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover/preview:opacity-100"
            >
              <Expand />
            </Button>
          )}
        </div>
        <DialogContent
          className="flex max-h-[92vh] max-w-[min(92vw,calc(62vh*var(--ar)))] flex-col gap-3 overflow-y-auto p-4"
          style={{ ["--ar" as string]: `${ar}` }}
        >
          <DialogTitle>In-World Preview</DialogTitle>
          <div
            className={cn(
              "relative flex w-full items-center justify-center overflow-hidden rounded-md border",
              checkerBg(24),
            )}
            style={{ aspectRatio: `${ar}` }}
          >
            <PlaybackCanvas {...props} playing className="h-full w-full" />
          </div>
          {controls}
        </DialogContent>
      </Dialog>
    </div>
  );
}
