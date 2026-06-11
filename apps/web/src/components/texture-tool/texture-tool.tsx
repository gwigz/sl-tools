"use client"

import { RotateCcw } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { useSnapshot } from "valtio"

import { Button } from "~/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog"
import { useAutoMatch } from "~/hooks/use-auto-match"
import { useFrameExtraction } from "~/hooks/use-frame-extraction"
import { useImageSlot } from "~/hooks/use-image-slot"
import { useSettingsPersistence } from "~/hooks/use-settings-persistence"
import { useUndoRedo } from "~/hooks/use-undo-redo"
import { type AspectState, resolveAspect } from "~/lib/sl/aspect"
import { canvasToBlob, composeSheet, type MaskOptions, type OverlayOptions } from "~/lib/sl/compose"
import { autoGrid, chooseSheet } from "~/lib/sl/grid"
import { buildScript } from "~/lib/sl/lsl"

import { ApplyCard } from "./apply-card"
import { FramesGridCard } from "./frames-grid-card"
import { OutputCard } from "./output-card"
import { PreviewPane } from "./preview-pane"
import { SourceCard } from "./source-card"
import { settings, ui } from "./store"

export function TextureTool() {
  const [sheet, setSheet] = useState<HTMLCanvasElement | null>(null)
  const [pngSize, setPngSize] = useState<number | null>(null)

  const snap = useSnapshot(settings)
  const {
    fps,
    frameCount,
    autoGridOn,
    manualCols,
    manualRows,
    maxSize,
    pow2,
    stretchGrid,
    fit,
    backgroundMode,
    background,
    backgroundFit,
    backgroundPerCell,
    overlayEnabled,
    overlayOpacity,
    overlayBlend,
    overlayFit,
    overlayPerCell,
    maskEnabled,
    maskSource,
    maskInvert,
    maskFit,
    maskPerCell,
    maskCutOverlay,
    loop,
    reverse,
    pingPong,
    scriptLang,
    linkMode,
    linkNum,
    faceAll,
    faceNum,
  } = snap
  const aspect = snap.aspect as AspectState
  const uiSnap = useSnapshot(ui)
  const trim = uiSnap.trim as [number, number]
  const resetOpen = uiSnap.resetOpen

  const faceAspect = resolveAspect(aspect)

  const { cols, rows } = useMemo(() => {
    if (autoGridOn) {
      return autoGrid(frameCount)
    }

    return { cols: Math.max(1, manualCols), rows: Math.max(1, manualRows) }
  }, [autoGridOn, frameCount, manualCols, manualRows])

  const sheetDims = useMemo(
    () => chooseSheet(cols, rows, stretchGrid ? 1 : faceAspect, maxSize, pow2),
    [cols, rows, faceAspect, maxSize, pow2, stretchGrid],
  )

  const cellCapacity = cols * rows
  const targetFrames = autoGridOn ? frameCount : cellCapacity
  const placedFrames = Math.min(targetFrames, cellCapacity)

  const { hydrated, resetSettings } = useSettingsPersistence()
  const {
    bitmap: overlayBitmap,
    name: overlayName,
    handleSelect: handleOverlay,
    reset: resetOverlay,
  } = useImageSlot("sl-texanim:overlay:v1", "Could not load overlay image")
  const {
    bitmap: maskBitmap,
    name: maskName,
    handleSelect: handleMask,
    reset: resetMask,
  } = useImageSlot("sl-texanim:mask:v1", "Could not load mask image")
  const {
    bitmap: backgroundBitmap,
    name: backgroundName,
    handleSelect: handleBackground,
    reset: resetBackground,
  } = useImageSlot("sl-texanim:background:v1", "Could not load background image")
  const {
    sampler,
    meta,
    loadingSource,
    frames,
    timelineThumbs,
    inFrame,
    outFrame,
    extracting,
    progress,
    durationSec,
    frameStep,
    handleSelect,
    requestFrame,
  } = useFrameExtraction({ targetFrames })
  const { autoMatching, handleAutoMatch } = useAutoMatch({
    sampler,
    durationSec,
    frameStep,
    framesLength: frames.length,
    fps,
  })
  useUndoRedo(hydrated)

  const regenerating = extracting || loadingSource
  const trimLength = trim[1] - trim[0]
  const loopLength = fps > 0 ? placedFrames / fps : 0
  const matchedFps =
    trimLength > 0 ? Math.min(60, Math.max(1, Math.round(placedFrames / trimLength))) : fps

  const commitTrim = useCallback((next: [number, number]) => {
    ui.trim = next
    settings.committedTrim = next
  }, [])

  const handleReset = useCallback(() => {
    resetSettings()
    resetOverlay()
    resetMask()
    resetBackground()
    ui.resetOpen = false
    toast.success("Settings reset to defaults")
  }, [resetSettings, resetOverlay, resetMask, resetBackground])

  useEffect(() => {
    if (frames.length === 0) {
      setSheet(null)
      return
    }
    const overlay: OverlayOptions | null =
      overlayEnabled && overlayBitmap
        ? {
            bitmap: overlayBitmap,
            opacity: overlayOpacity,
            blend: overlayBlend,
            fit: overlayFit,
            perCell: overlayPerCell,
          }
        : null

    const mask: MaskOptions | null =
      maskEnabled && maskBitmap
        ? {
            bitmap: maskBitmap,
            source: maskSource,
            invert: maskInvert,
            fit: maskFit,
            perCell: maskPerCell,
            cutOverlay: maskCutOverlay,
          }
        : null

    const backgroundImage: OverlayOptions | null =
      backgroundMode === "image" && backgroundBitmap
        ? {
            bitmap: backgroundBitmap,
            opacity: 1,
            blend: "source-over",
            fit: backgroundFit,
            perCell: backgroundPerCell,
          }
        : null

    setSheet(
      composeSheet({
        frames,
        cols,
        rows,
        sheetWidth: sheetDims.sheetWidth,
        sheetHeight: sheetDims.sheetHeight,
        fit,
        faceAspect,
        background: backgroundMode === "color" ? background : "transparent",
        backgroundImage,
        overlay,
        mask,
      }),
    )
  }, [
    frames,
    cols,
    rows,
    sheetDims.sheetWidth,
    sheetDims.sheetHeight,
    fit,
    faceAspect,
    backgroundMode,
    background,
    backgroundFit,
    backgroundPerCell,
    backgroundBitmap,
    overlayEnabled,
    overlayBitmap,
    overlayOpacity,
    overlayBlend,
    overlayFit,
    overlayPerCell,
    maskEnabled,
    maskBitmap,
    maskSource,
    maskInvert,
    maskFit,
    maskPerCell,
    maskCutOverlay,
  ])

  const link = linkMode === "this" ? null : linkMode === "specific" ? String(linkNum) : linkMode
  const face = faceAll ? "ALL_SIDES" : String(faceNum)

  const script = useMemo(
    () =>
      buildScript(scriptLang, {
        cols,
        rows,
        fps,
        frameCount: placedFrames,
        loop,
        reverse,
        pingPong,
        face,
        link,
      }),
    [scriptLang, cols, rows, fps, placedFrames, loop, reverse, pingPong, face, link],
  )

  const baseName = meta?.name.replace(/\.[^.]+$/, "") ?? "texture"

  useEffect(() => {
    if (!sheet) {
      setPngSize(null)
      return
    }

    let cancelled = false

    const timer = setTimeout(() => {
      canvasToBlob(sheet)
        .then((blob) => {
          if (!cancelled) {
            setPngSize(blob.size)
          }
        })
        .catch(() => {})
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sheet])

  const handleDownload = useCallback(async () => {
    if (!sheet) {
      return
    }

    const blob = await canvasToBlob(sheet)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${baseName}_${cols}x${rows}_${fps}fps.png`
    anchor.click()
    URL.revokeObjectURL(url)
  }, [sheet, baseName, cols, rows, fps])

  const copyScript = useCallback(() => {
    navigator.clipboard
      .writeText(script)
      .then(() => toast.success("Script copied"))
      .catch(() => toast.error("Clipboard unavailable"))
  }, [script])

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-start">
      <div className="flex items-start justify-between gap-4 lg:col-span-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Media to{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-primary">
              llSetTextureAnim
            </code>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Runs entirely in your browser, nothing is uploaded
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 text-muted-foreground"
          onClick={() => (ui.resetOpen = true)}
        >
          <RotateCcw /> Reset
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <SourceCard
          onSelect={handleSelect}
          meta={meta}
          loadingSource={loadingSource}
          preview={meta ? (frames[0] ?? null) : null}
        />
        <FramesGridCard
          meta={meta}
          durationSec={durationSec}
          trimLength={trimLength}
          loopLength={loopLength}
          matchedFps={matchedFps}
          frames={frames}
          inFrame={inFrame}
          outFrame={outFrame}
          faceAspect={faceAspect}
          extracting={extracting}
          autoMatching={autoMatching}
          timelineThumbs={timelineThumbs}
          frameStep={frameStep}
          cols={cols}
          rows={rows}
          cellCapacity={cellCapacity}
          placedFrames={placedFrames}
          sheetDims={sheetDims}
          onCommitTrim={commitTrim}
          onAutoMatch={handleAutoMatch}
          requestFrame={requestFrame}
        />
        <OutputCard
          faceAspect={faceAspect}
          overlayBitmap={overlayBitmap}
          overlayName={overlayName}
          onOverlay={handleOverlay}
          maskBitmap={maskBitmap}
          maskName={maskName}
          onMask={handleMask}
          backgroundBitmap={backgroundBitmap}
          backgroundName={backgroundName}
          onBackground={handleBackground}
        />
        <ApplyCard script={script} onCopy={copyScript} />
      </div>

      <Dialog open={resetOpen} onOpenChange={(open) => (ui.resetOpen = open)}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Reset all settings?</DialogTitle>
          <DialogDescription>
            This clears your saved preferences, overlay and mask textures and restores the defaults,
            your current source stays loaded
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => (ui.resetOpen = false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleReset}>
              Reset
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PreviewPane
        sheet={sheet}
        cols={cols}
        rows={rows}
        placedFrames={placedFrames}
        faceAspect={faceAspect}
        durationSec={durationSec}
        frames={frames}
        inFrame={inFrame}
        outFrame={outFrame}
        timelineThumbs={timelineThumbs}
        frameStep={frameStep}
        sheetDims={sheetDims}
        pngSize={pngSize}
        regenerating={regenerating}
        meta={meta}
        trimLength={trimLength}
        matchedFps={matchedFps}
        extracting={extracting}
        progress={progress}
        onCommitTrim={commitTrim}
        requestFrame={requestFrame}
        onDownload={handleDownload}
        onCopy={copyScript}
      />
    </div>
  )
}
