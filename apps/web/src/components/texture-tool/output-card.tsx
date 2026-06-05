"use client";

import { ArrowRight, ImageIcon, TriangleAlert } from "lucide-react";
import { useSnapshot } from "valtio";

import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ColorPicker } from "~/components/ui/color-picker";
import { CardDivider, NumberField, SliderField, SwitchRow } from "~/components/ui/field";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { type AspectState, ASPECT_PRESETS, describeAspect } from "~/lib/sl/aspect";
import type { FitMode } from "~/lib/sl/compose";

import { Dropzone } from "./dropzone";
import { settings } from "./store";

const OVERLAY_ACCEPT = "image/*,.tga,image/tga,image/x-tga,image/targa";
const OUTPUT_SIZES = [128, 256, 512, 1024, 2048, 4096];

const BLEND_MODES: { label: string; value: GlobalCompositeOperation }[] = [
  { label: "Normal", value: "source-over" },
  { label: "Multiply", value: "multiply" },
  { label: "Screen", value: "screen" },
  { label: "Overlay", value: "overlay" },
  { label: "Lighten", value: "lighten" },
  { label: "Darken", value: "darken" },
  { label: "Add", value: "lighter" },
];

export function OutputCard({
  faceAspect,
  overlayBitmap,
  overlayName,
  onOverlay,
}: {
  faceAspect: number;
  overlayBitmap: ImageBitmap | null;
  overlayName: string | null;
  onOverlay: (file: File) => void;
}) {
  const s = useSnapshot(settings);
  const aspect = s.aspect as AspectState;
  const {
    maxSize,
    fit,
    pow2,
    stretchGrid,
    transparent,
    background,
    overlayEnabled,
    overlayOpacity,
    overlayBlend,
    overlayFit,
    overlayPerCell,
  } = s;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="size-4" /> Output
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <Label className="text-xs">Face Aspect</Label>
          <Tabs
            value={aspect.mode}
            onValueChange={(v) =>
              (settings.aspect = { ...settings.aspect, mode: v as AspectState["mode"] })
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
              onValueChange={(v) =>
                (settings.aspect = { ...settings.aspect, preset: v ?? settings.aspect.preset })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASPECT_PRESETS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
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
                onChange={(v) => (settings.aspect = { ...settings.aspect, pixelW: v })}
              />
              <NumberField
                label="Height (px)"
                value={aspect.pixelH}
                min={1}
                max={4096}
                onChange={(v) => (settings.aspect = { ...settings.aspect, pixelH: v })}
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
                onChange={(v) => (settings.aspect = { ...settings.aspect, meterW: v })}
              />
              <NumberField
                label="Height (m)"
                value={aspect.meterH}
                min={0.01}
                max={64}
                step={0.1}
                onChange={(v) => (settings.aspect = { ...settings.aspect, meterH: v })}
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
            <Select value={String(maxSize)} onValueChange={(v) => (settings.maxSize = Number(v))}>
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
            <Select value={fit} onValueChange={(v) => (settings.fit = v as FitMode)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">Cover (crop)</SelectItem>
                <SelectItem value="contain">Contain (letterbox)</SelectItem>
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
          onChange={(v) => (settings.pow2 = v)}
        />
        <SwitchRow
          label="Stretch Grid"
          hint="Store frames in square cells for extra resolution; SL stretches them back to the face"
          checked={stretchGrid}
          onChange={(v) => (settings.stretchGrid = v)}
        />
        <SwitchRow
          label="Transparent Background"
          checked={transparent}
          onChange={(v) => (settings.transparent = v)}
        />
        {!transparent && (
          <div className="flex items-center justify-between gap-3">
            <Label className="text-xs">Background Color</Label>
            <ColorPicker value={background} onChange={(v) => (settings.background = v)} alpha />
          </div>
        )}

        <CardDivider />

        <SwitchRow
          label="Overlay Texture"
          hint="Composite an image on top of every frame"
          checked={overlayEnabled}
          onChange={(v) => (settings.overlayEnabled = v)}
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
              onChange={(v) => (settings.overlayOpacity = v / 100)}
              suffix="%"
            />
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Blend</Label>
                <Select
                  value={overlayBlend}
                  onValueChange={(v) => (settings.overlayBlend = v as GlobalCompositeOperation)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BLEND_MODES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Fit</Label>
                <Select
                  value={overlayFit}
                  onValueChange={(v) => (settings.overlayFit = v as FitMode)}
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
              onChange={(v) => (settings.overlayPerCell = v)}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
