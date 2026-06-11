"use client"

import { ArrowRight, ImageIcon, TriangleAlert } from "lucide-react"
import { useSnapshot } from "valtio"

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { ColorPicker } from "~/components/ui/color-picker"
import { CardDivider, NumberField, SliderField, SwitchRow } from "~/components/ui/field"
import { Label } from "~/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs"
import { type AspectState, ASPECT_PRESETS, describeAspect } from "~/lib/sl/aspect"
import type { BackgroundMode, FitMode, MaskSource } from "~/lib/sl/compose"

import { Dropzone } from "./dropzone"
import { settings } from "./store"

const OVERLAY_ACCEPT = "image/*,.tga,image/tga,image/x-tga,image/targa"
const OUTPUT_SIZES = [128, 256, 512, 1024, 2048, 4096]

const BLEND_MODES: { label: string; value: GlobalCompositeOperation }[] = [
  { label: "Normal", value: "source-over" },
  { label: "Multiply", value: "multiply" },
  { label: "Screen", value: "screen" },
  { label: "Overlay", value: "overlay" },
  { label: "Lighten", value: "lighten" },
  { label: "Darken", value: "darken" },
  { label: "Add", value: "lighter" },
]

export function OutputCard({
  faceAspect,
  overlayBitmap,
  overlayName,
  onOverlay,
  maskBitmap,
  maskName,
  onMask,
  backgroundBitmap,
  backgroundName,
  onBackground,
}: {
  faceAspect: number
  overlayBitmap: ImageBitmap | null
  overlayName: string | null
  onOverlay: (file: File) => void
  maskBitmap: ImageBitmap | null
  maskName: string | null
  onMask: (file: File) => void
  backgroundBitmap: ImageBitmap | null
  backgroundName: string | null
  onBackground: (file: File) => void
}) {
  const snap = useSnapshot(settings)
  const aspect = snap.aspect as AspectState
  const {
    maxSize,
    fit,
    pow2,
    stretchGrid,
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
  } = snap

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="size-4" />
          <span>Output</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label className="text-xs">Face Aspect</Label>
          <Tabs
            value={aspect.mode}
            onValueChange={(value) =>
              (settings.aspect = { ...settings.aspect, mode: value as AspectState["mode"] })
            }
          >
            <TabsList className="w-full">
              <TabsTrigger value="preset" className="flex-1">
                Preset
              </TabsTrigger>
              <TabsTrigger value="pixels" className="flex-1">
                Pixels
              </TabsTrigger>
              <TabsTrigger value="meters" className="flex-1">
                Meters
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {aspect.mode === "preset" && (
            <Select
              value={aspect.preset}
              onValueChange={(value) =>
                (settings.aspect = { ...settings.aspect, preset: value ?? settings.aspect.preset })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASPECT_PRESETS.map((preset) => (
                  <SelectItem key={preset.value} value={preset.value}>
                    {preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {aspect.mode === "pixels" && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Width (px)"
                value={aspect.pixelW}
                min={1}
                max={4096}
                onChange={(value) => (settings.aspect = { ...settings.aspect, pixelW: value })}
              />
              <NumberField
                label="Height (px)"
                value={aspect.pixelH}
                min={1}
                max={4096}
                onChange={(value) => (settings.aspect = { ...settings.aspect, pixelH: value })}
              />
            </div>
          )}
          {aspect.mode === "meters" && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Width (m)"
                value={aspect.meterW}
                min={0.01}
                max={64}
                step={0.1}
                onChange={(value) => (settings.aspect = { ...settings.aspect, meterW: value })}
              />
              <NumberField
                label="Height (m)"
                value={aspect.meterH}
                min={0.01}
                max={64}
                step={0.1}
                onChange={(value) => (settings.aspect = { ...settings.aspect, meterH: value })}
              />
            </div>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Face {describeAspect(aspect)}
            <ArrowRight className="size-3" />
            ratio {faceAspect.toFixed(3)}:1
          </p>
        </div>

        <CardDivider />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Max Size</Label>
            <Select
              value={String(maxSize)}
              onValueChange={(value) => (settings.maxSize = Number(value))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OUTPUT_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Frame Fit</Label>
            <Select value={fit} onValueChange={(value) => (settings.fit = value as FitMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">Cover (Crop)</SelectItem>
                <SelectItem value="contain">Contain (Letterbox)</SelectItem>
                <SelectItem value="stretch">Stretch</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {maxSize > 2048 && (
          <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
            <TriangleAlert className="size-3 shrink-0" />
            Second Life downscales uploads above 2048px to 2048px
          </p>
        )}
        <SwitchRow
          label="Power-of-Two"
          hint="Required for Second Life, sizes 8 to 2048, can be non-square"
          checked={pow2}
          onChange={(value) => (settings.pow2 = value)}
        />
        <SwitchRow
          label="Stretch Grid"
          hint="Store frames in square cells for extra resolution; SL stretches them back to the face"
          checked={stretchGrid}
          onChange={(value) => (settings.stretchGrid = value)}
        />
        <div className="flex flex-col gap-2">
          <Label className="text-xs">Background</Label>
          <Tabs
            value={backgroundMode}
            onValueChange={(value) => (settings.backgroundMode = value as BackgroundMode)}
          >
            <TabsList className="w-full">
              <TabsTrigger value="transparent" className="flex-1">
                Transparent
              </TabsTrigger>
              <TabsTrigger value="color" className="flex-1">
                Color
              </TabsTrigger>
              <TabsTrigger value="image" className="flex-1">
                Image
              </TabsTrigger>
            </TabsList>
          </Tabs>
          {backgroundMode === "color" && (
            <div className="flex items-center justify-between gap-3">
              <Label className="text-xs">Background Color</Label>
              <ColorPicker
                value={background}
                onChange={(value) => (settings.background = value)}
                alpha
              />
            </div>
          )}
          {backgroundMode === "image" && (
            <>
              <Dropzone
                onSelect={onBackground}
                accept={OVERLAY_ACCEPT}
                compact
                preview={backgroundBitmap}
                label={backgroundName ?? "Choose Background (PNG, TGA…)"}
              />
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Fit</Label>
                <Select
                  value={backgroundFit}
                  onValueChange={(value) => (settings.backgroundFit = value as FitMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cover">Cover</SelectItem>
                    <SelectItem value="contain">Contain</SelectItem>
                    <SelectItem value="stretch">Stretch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <SwitchRow
                label="Apply Per Frame"
                hint="Draw on each cell instead of the whole sheet"
                checked={backgroundPerCell}
                onChange={(value) => (settings.backgroundPerCell = value)}
              />
            </>
          )}
        </div>

        <CardDivider />

        <SwitchRow
          label="Mask Texture"
          hint="Alpha-cut frames using another image"
          checked={maskEnabled}
          onChange={(value) => (settings.maskEnabled = value)}
        />
        {maskEnabled && (
          <>
            <Dropzone
              onSelect={onMask}
              accept={OVERLAY_ACCEPT}
              compact
              preview={maskBitmap}
              label={maskName ?? "Choose Mask (PNG, TGA…)"}
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Mask From</Label>
                <Select
                  value={maskSource}
                  onValueChange={(value) => (settings.maskSource = value as MaskSource)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alpha">Alpha Channel</SelectItem>
                    <SelectItem value="color">Color Channels</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Fit</Label>
                <Select
                  value={maskFit}
                  onValueChange={(value) => (settings.maskFit = value as FitMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stretch">Stretch</SelectItem>
                    <SelectItem value="cover">Cover</SelectItem>
                    <SelectItem value="contain">Contain</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <SwitchRow
              label="Invert Mask"
              hint="Cut where the mask is opaque or bright instead"
              checked={maskInvert}
              onChange={(value) => (settings.maskInvert = value)}
            />
            <SwitchRow
              label="Apply Per Frame"
              hint="Cut each cell instead of the whole sheet"
              checked={maskPerCell}
              onChange={(value) => (settings.maskPerCell = value)}
            />
            {overlayEnabled && (
              <SwitchRow
                label="Cut Overlay"
                hint="Also mask the overlay texture, not just the frames"
                checked={maskCutOverlay}
                onChange={(value) => (settings.maskCutOverlay = value)}
              />
            )}
          </>
        )}

        <CardDivider />

        <SwitchRow
          label="Overlay Texture"
          hint="Composite an image on top of every frame"
          checked={overlayEnabled}
          onChange={(value) => (settings.overlayEnabled = value)}
        />
        {overlayEnabled && (
          <>
            <Dropzone
              onSelect={onOverlay}
              accept={OVERLAY_ACCEPT}
              compact
              preview={overlayBitmap}
              label={overlayName ?? "Choose Overlay (PNG, TGA…)"}
            />
            <SliderField
              label="Opacity"
              value={Math.round(overlayOpacity * 100)}
              min={0}
              max={100}
              step={1}
              onChange={(value) => (settings.overlayOpacity = value / 100)}
              suffix="%"
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Blend</Label>
                <Select
                  value={overlayBlend}
                  onValueChange={(value) =>
                    (settings.overlayBlend = value as GlobalCompositeOperation)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BLEND_MODES.map((mode) => (
                      <SelectItem key={mode.value} value={mode.value}>
                        {mode.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Fit</Label>
                <Select
                  value={overlayFit}
                  onValueChange={(value) => (settings.overlayFit = value as FitMode)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="stretch">Stretch</SelectItem>
                    <SelectItem value="cover">Cover</SelectItem>
                    <SelectItem value="contain">Contain</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <SwitchRow
              label="Apply Per Frame"
              hint="Draw on each cell instead of the whole sheet"
              checked={overlayPerCell}
              onChange={(value) => (settings.overlayPerCell = value)}
            />
          </>
        )}
      </CardContent>
    </Card>
  )
}
