"use client"

import { Copy, Download, TriangleAlert } from "lucide-react"
import { useSnapshot } from "valtio"

import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader } from "~/components/ui/card"
import { CardDivider } from "~/components/ui/field"
import { Spinner } from "~/components/ui/spinner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs"
import type { SourceMeta } from "~/hooks/use-frame-extraction"
import { formatBytes } from "~/lib/utils"

import { SeamFrame } from "./loop-seam"
import { SheetPreview } from "./sheet-preview"
import { SlPreview } from "./sl-preview"
import { settings, ui } from "./store"
import { type TimelineThumb, TrimTimeline } from "./trim-timeline"

export function PreviewPane({
  sheet,
  cols,
  rows,
  placedFrames,
  faceAspect,
  durationSec,
  frames,
  inFrame,
  outFrame,
  timelineThumbs,
  frameStep,
  sheetDims,
  pngSize,
  regenerating,
  meta,
  trimLength,
  matchedFps,
  extracting,
  progress,
  onCommitTrim,
  requestFrame,
  onDownload,
  onCopy,
}: {
  sheet: HTMLCanvasElement | null
  cols: number
  rows: number
  placedFrames: number
  faceAspect: number
  durationSec: number
  frames: ImageBitmap[]
  inFrame: ImageBitmap | null
  outFrame: ImageBitmap | null
  timelineThumbs: TimelineThumb[]
  frameStep: number
  sheetDims: { sheetWidth: number; sheetHeight: number }
  pngSize: number | null
  regenerating: boolean
  meta: SourceMeta | null
  trimLength: number
  matchedFps: number
  extracting: boolean
  progress: number
  onCommitTrim: (value: [number, number]) => void
  requestFrame: (timeSec: number) => Promise<ImageBitmap | null>
  onDownload: () => void
  onCopy: () => void
}) {
  const { fps, reverse, pingPong, loop } = useSnapshot(settings)
  const trim = useSnapshot(ui).trim as [number, number]

  return (
    <div className="flex flex-col gap-3 lg:sticky lg:top-4">
      <Card size="sm">
        <Tabs defaultValue="preview">
          <CardHeader>
            <TabsList className="w-full">
              <TabsTrigger value="preview" className="flex-1">
                Preview
              </TabsTrigger>
              <TabsTrigger value="sheet" className="flex-1">
                Sheet
              </TabsTrigger>
            </TabsList>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <TabsContent value="preview">
              <SlPreview
                sheet={sheet}
                cols={cols}
                rows={rows}
                frameCount={placedFrames}
                fps={fps}
                faceAspect={faceAspect}
                reverse={reverse}
                pingPong={pingPong}
                loop={loop}
                controls={
                  durationSec > 0 ? (
                    <div className="flex items-stretch gap-3">
                      <SeamFrame
                        bitmap={inFrame ?? frames[0] ?? null}
                        faceAspect={faceAspect}
                        fill
                      />
                      <div className="min-w-0 flex-1">
                        <TrimTimeline
                          durationSec={durationSec}
                          thumbs={timelineThumbs}
                          value={trim}
                          frameStep={frameStep}
                          onChange={(value) => (ui.trim = value)}
                          onCommit={onCommitTrim}
                          requestFrame={requestFrame}
                        />
                      </div>
                      <SeamFrame
                        bitmap={outFrame ?? frames.at(-1) ?? null}
                        faceAspect={faceAspect}
                        fill
                      />
                    </div>
                  ) : undefined
                }
              />
            </TabsContent>
            <TabsContent value="sheet">
              <SheetPreview sheet={sheet} cols={cols} rows={rows} />
            </TabsContent>

            <CardDivider />

            <div className="flex gap-2">
              <Button
                size="lg"
                className="flex-1"
                onClick={onDownload}
                disabled={!sheet || regenerating}
              >
                {regenerating ? <Spinner /> : <Download />}
                {regenerating ? "Regenerating…" : "Download texture PNG"}
              </Button>
              <Button size="icon-lg" variant="outline" aria-label="Copy script" onClick={onCopy}>
                <Copy />
              </Button>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {sheetDims.sheetWidth}×{sheetDims.sheetHeight}px
                {pngSize !== null && ` · ${formatBytes(pngSize)}`}
              </span>
              <span>
                {cols}×{rows} grid · {placedFrames} frames
              </span>
            </div>
            {meta && trimLength > 0 && Math.abs(fps - matchedFps) >= 1 && (
              <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                <TriangleAlert className="size-3 shrink-0" />
                FPS not synced to loop ({matchedFps} fps)
              </p>
            )}
            {extracting && (
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{Math.round(progress * 100)}%</span>
              </div>
            )}
          </CardContent>
        </Tabs>
      </Card>
    </div>
  )
}
