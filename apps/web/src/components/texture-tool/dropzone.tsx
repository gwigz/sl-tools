"use client";

import { FileVideo, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";

const DEFAULT_ACCEPT = "video/*,image/gif,image/webp,image/apng,image/png,image/*";

export function Dropzone({
  onSelect,
  compact = false,
  accept = DEFAULT_ACCEPT,
  preview = null,
  label,
}: {
  onSelect: (file: File) => void;
  compact?: boolean;
  accept?: string;
  preview?: ImageBitmap | null;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) onSelect(file);
    },
    [onSelect],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex cursor-pointer items-center rounded-lg border border-dashed text-center transition-colors",
        "hover:border-primary/50 hover:bg-muted/40",
        dragging ? "border-primary bg-primary/5" : "border-border",
        compact ? "gap-3 p-3 text-left" : "flex-col justify-center gap-3 p-10",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {compact && preview ? (
        <Thumbnail bitmap={preview} />
      ) : (
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
            compact ? "size-9" : "size-12",
          )}
        >
          {compact ? <Upload className="size-4" /> : <FileVideo className="size-6" />}
        </div>
      )}

      <div className={cn(compact && "min-w-0 flex-1")}>
        <p className={cn("truncate font-medium", compact ? "text-xs" : "text-sm")}>
          {label ?? (compact ? "Replace source" : "Drop a video or GIF here")}
        </p>
        <p
          className={cn(
            "truncate text-muted-foreground",
            compact ? "text-[0.7rem]" : "mt-1 text-xs",
          )}
        >
          {compact
            ? "Click or drop to replace"
            : "Or click to browse. Supports MP4, WebM, MOV, GIF, and animated WebP or PNG."}
        </p>
      </div>
    </div>
  );
}

function Thumbnail({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const size = 44;
    const scale = Math.min(size / bitmap.width, size / bitmap.height);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(bitmap, 0, 0, w, h);
  }, [bitmap]);

  return (
    <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-[conic-gradient(#0000_90deg,#80808015_0_180deg,#0000_0_270deg,#80808015_0)] bg-[length:10px_10px]">
      <canvas ref={ref} className="max-h-full max-w-full" />
    </div>
  );
}
