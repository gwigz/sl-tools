"use client"

import { FileVideo, Upload } from "lucide-react"
import { useCallback, useRef, useState } from "react"

import { ScaledCanvasBitmap } from "~/components/ui/canvas-bitmap"
import { checkerBg, cn } from "~/lib/utils"

const DEFAULT_ACCEPT = "video/*,image/gif,image/webp,image/apng,image/png,image/*"

export function Dropzone({
  onSelect,
  compact = false,
  accept = DEFAULT_ACCEPT,
  preview = null,
  label,
}: {
  onSelect: (file: File) => void
  compact?: boolean
  accept?: string
  preview?: ImageBitmap | null
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]

      if (file) {
        onSelect(file)
      }
    },
    [onSelect],
  )

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        handleFiles(event.dataTransfer.files)
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
        onChange={(event) => handleFiles(event.target.files)}
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
          {label ?? (compact ? "Replace source" : "Drop any video or animated image")}
        </p>
        <p
          className={cn(
            "truncate text-muted-foreground",
            compact ? "text-[0.7rem]" : "mt-1 text-xs",
          )}
        >
          {compact ? "Click or drop to replace" : "or click to browse"}
        </p>
      </div>
    </div>
  )
}

function Thumbnail({ bitmap }: { bitmap: ImageBitmap }) {
  return (
    <div
      className={cn(
        "flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md border",
        checkerBg(10),
      )}
    >
      <ScaledCanvasBitmap bitmap={bitmap} size={44} className="max-h-full max-w-full" />
    </div>
  )
}
