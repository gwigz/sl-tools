"use client"

import { Grid3x3, Wand2 } from "lucide-react"
import { useSnapshot } from "valtio"

import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { CardDivider, NumberField, SliderField, SwitchRow } from "~/components/ui/field"
import { Label } from "~/components/ui/label"
import { formatClock } from "~/lib/utils"

import { LoopSeam } from "./loop-seam"
import type { SourceMeta } from "~/hooks/use-frame-extraction"
import { settings, ui } from "./store"
import { type TimelineThumb, TrimTimeline } from "./trim-timeline"

const MAX_FRAMES = 256

export function FramesGridCard({
  meta,
  durationSec,
  trimLength,
  loopLength,
  matchedFps,
  frames,
  inFrame,
  outFrame,
  faceAspect,
  extracting,
  autoMatching,
  timelineThumbs,
  frameStep,
  cols,
  rows,
  cellCapacity,
  placedFrames,
  sheetDims,
  onCommitTrim,
  onAutoMatch,
  requestFrame,
}: {
  meta: SourceMeta | null
  durationSec: number
  trimLength: number
  loopLength: number
  matchedFps: number
  frames: ImageBitmap[]
  inFrame: ImageBitmap | null
  outFrame: ImageBitmap | null
  faceAspect: number
  extracting: boolean
  autoMatching: boolean
  timelineThumbs: TimelineThumb[]
  frameStep: number
  cols: number
  rows: number
  cellCapacity: number
  placedFrames: number
  sheetDims: { sheetWidth: number; sheetHeight: number }
  onCommitTrim: (value: [number, number]) => void
  onAutoMatch: () => void
  requestFrame: (timeSec: number) => Promise<ImageBitmap | null>
}) {
  const { autoGridOn, frameCount, fps, manualCols, manualRows, loop, reverse, pingPong } =
    useSnapshot(settings)
  const trim = useSnapshot(ui).trim as [number, number]

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Grid3x3 className="size-4" /> Frames &amp; Grid
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {autoGridOn ? (
          <SliderField
            label="Frames"
            value={frameCount}
            min={1}
            max={MAX_FRAMES}
            step={1}
            onChange={(value) => (settings.frameCount = value)}
          />
        ) : (
          <div className="flex items-center justify-between text-xs">
            <Label className="text-xs">Frames</Label>
            <span className="font-mono text-muted-foreground">
              {cellCapacity} (grid {cols}×{rows})
            </span>
          </div>
        )}
        <SliderField
          label="FPS"
          value={fps}
          min={1}
          max={60}
          step={1}
          onChange={(value) => (settings.fps = value)}
          suffix="fps"
        />
        {meta && durationSec > 0 && trimLength > 0 && (
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-muted-foreground">
              loop {formatClock(loopLength)} · source {formatClock(trimLength)}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => (settings.fps = matchedFps)}
            >
              <Wand2 /> Match
            </Button>
          </div>
        )}
        {meta && durationSec > 0 && (
          <>
            <CardDivider />
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Trim &amp; Loop</Label>
                <span className="font-mono text-xs text-muted-foreground">
                  {formatClock(trim[0])} to {formatClock(trim[1])}
                </span>
              </div>
              <TrimTimeline
                durationSec={durationSec}
                thumbs={timelineThumbs}
                value={trim}
                frameStep={frameStep}
                onChange={(value) => (ui.trim = value)}
                onCommit={onCommitTrim}
                requestFrame={requestFrame}
              />
              {frames.length > 1 && (
                <LoopSeam
                  frames={frames}
                  inFrame={inFrame}
                  outFrame={outFrame}
                  startTime={trim[0]}
                  endTime={trim[1]}
                  faceAspect={faceAspect}
                  loading={extracting}
                  onAutoMatch={onAutoMatch}
                  autoMatching={autoMatching}
                  onExpand={() => {
                    ui.previewOpen = true
                  }}
                />
              )}
            </div>
          </>
        )}

        <CardDivider />

        <div className="flex flex-col gap-2">
          <Label className="text-xs">Script Settings</Label>
          <div className="flex flex-wrap gap-4">
            <SwitchRow
              label="Loop"
              checked={loop}
              onChange={(value) => (settings.loop = value)}
              inline
            />
            <SwitchRow
              label="Reverse"
              checked={reverse}
              onChange={(value) => (settings.reverse = value)}
              inline
            />
            <SwitchRow
              label="Ping-Pong"
              checked={pingPong}
              onChange={(value) => (settings.pingPong = value)}
              inline
            />
          </div>
        </div>

        <CardDivider />

        <SwitchRow
          label="Auto Grid"
          hint="Choose rows and columns automatically"
          checked={autoGridOn}
          onChange={(value) => (settings.autoGridOn = value)}
        />
        {!autoGridOn && (
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Columns"
              value={manualCols}
              min={1}
              max={255}
              onChange={(value) => (settings.manualCols = value)}
            />
            <NumberField
              label="Rows"
              value={manualRows}
              min={1}
              max={255}
              onChange={(value) => (settings.manualRows = value)}
            />
          </div>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {cols} × {rows} grid ({cellCapacity} cells · {Math.floor(sheetDims.sheetWidth / cols)}×
            {Math.floor(sheetDims.sheetHeight / rows)}
            px)
          </span>
          <span>{placedFrames} placed</span>
        </div>
      </CardContent>
    </Card>
  )
}
