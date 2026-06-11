import { proxy } from "valtio"

import { type AspectState, DEFAULT_ASPECT } from "~/lib/sl/aspect"
import type { BackgroundMode, FitMode, MaskSource } from "~/lib/sl/compose"
import type { ScriptLanguage } from "~/lib/sl/lsl"

export const DEFAULT_SETTINGS = {
  fps: 10,
  autoGridOn: true,
  manualCols: 4,
  manualRows: 4,
  maxSize: 2048,
  pow2: true,
  stretchGrid: false,
  fit: "cover" as FitMode,
  backgroundMode: "transparent" as BackgroundMode,
  background: "#000000",
  backgroundFit: "cover" as FitMode,
  backgroundPerCell: true,
  overlayEnabled: false,
  overlayOpacity: 1,
  overlayBlend: "source-over" as GlobalCompositeOperation,
  overlayFit: "stretch" as FitMode,
  overlayPerCell: true,
  maskEnabled: false,
  maskSource: "alpha" as MaskSource,
  maskInvert: false,
  maskFit: "stretch" as FitMode,
  maskPerCell: true,
  maskCutOverlay: false,
  loop: true,
  reverse: false,
  pingPong: false,
  scriptLang: "lsl" as ScriptLanguage,
  linkMode: "this",
  linkNum: 2,
  faceAll: true,
  faceNum: 0,
}

export type Settings = typeof DEFAULT_SETTINGS

/** Keys of `settings` that persist to localStorage (the rest are undo-only). */
export const PERSISTED_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]

// Serializable, undoable settings. `committedTrim`/`frameCount`/`aspect` are
// undoable but not persisted (they derive from the loaded source).
export const settings = proxy({
  ...DEFAULT_SETTINGS,
  frameCount: 16,
  committedTrim: [0, 0] as [number, number],
  aspect: { ...DEFAULT_ASPECT } as AspectState,
})

export type SettingsState = typeof settings

// Ephemeral UI / view state, not persisted, not undone.
export const ui = proxy({
  view: [0, 0] as [number, number],
  previewOpen: false,
  resetOpen: false,
  trim: [0, 0] as [number, number],
})
