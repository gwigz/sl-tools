"use client";

import { Expand } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

function SheetView({
  sheet,
  cols,
  rows,
  className,
}: {
  sheet: HTMLCanvasElement | null;
  cols: number;
  rows: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sheet) return;
    canvas.width = sheet.width;
    canvas.height = sheet.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sheet, 0, 0);
  }, [sheet]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border bg-[conic-gradient(#0000_90deg,#80808015_0_180deg,#0000_0_270deg,#80808015_0)] bg-[length:16px_16px]",
        className,
      )}
    >
      {sheet ? (
        <>
          <canvas ref={canvasRef} className="block h-auto w-full" />
          <div
            className="pointer-events-none absolute inset-0 grid"
            style={{
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
            }}
          >
            {Array.from({ length: cols * rows }, (_, i) => (
              <div key={i} className="border border-primary/25" />
            ))}
          </div>
        </>
      ) : (
        <div className="flex aspect-square items-center justify-center text-xs text-muted-foreground">
          Sheet appears here
        </div>
      )}
    </div>
  );
}

export function SheetPreview({
  sheet,
  cols,
  rows,
}: {
  sheet: HTMLCanvasElement | null;
  cols: number;
  rows: number;
}) {
  return (
    <Dialog>
      <div className="group/sheet relative">
        <SheetView sheet={sheet} cols={cols} rows={rows} />
        {sheet && (
          <DialogTrigger
            render={
              <Button
                variant="secondary"
                size="icon-sm"
                aria-label="Expand sheet"
                className="absolute top-2 right-2 opacity-0 shadow-sm transition-opacity focus-visible:opacity-100 group-hover/sheet:opacity-100"
              />
            }
          >
            <Expand />
          </DialogTrigger>
        )}
      </div>
      <DialogContent className="flex max-w-[min(90vw,90vh)] flex-col gap-3 p-4">
        <DialogTitle>Sprite Sheet</DialogTitle>
        <SheetView sheet={sheet} cols={cols} rows={rows} />
      </DialogContent>
    </Dialog>
  );
}
