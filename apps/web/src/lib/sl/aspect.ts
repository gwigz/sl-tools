export type AspectMode = "preset" | "pixels" | "meters";

export interface AspectPreset {
  label: string;
  value: string;
  aspect: number;
}

export const ASPECT_PRESETS: AspectPreset[] = [
  { label: "1:1 (square)", value: "1:1", aspect: 1 },
  { label: "2:1 (wide)", value: "2:1", aspect: 2 },
  { label: "1:2 (tall)", value: "1:2", aspect: 0.5 },
  { label: "4:3", value: "4:3", aspect: 4 / 3 },
  { label: "3:2", value: "3:2", aspect: 3 / 2 },
  { label: "16:9", value: "16:9", aspect: 16 / 9 },
  { label: "9:16", value: "9:16", aspect: 9 / 16 },
  { label: "21:9 (ultrawide)", value: "21:9", aspect: 21 / 9 },
];

export interface AspectState {
  mode: AspectMode;
  preset: string;
  pixelW: number;
  pixelH: number;
  meterW: number;
  meterH: number;
}

export const DEFAULT_ASPECT: AspectState = {
  mode: "preset",
  preset: "1:1",
  pixelW: 512,
  pixelH: 512,
  meterW: 1,
  meterH: 1,
};

export function resolveAspect(state: AspectState) {
  if (state.mode === "pixels") {
    return state.pixelW > 0 && state.pixelH > 0 ? state.pixelW / state.pixelH : 1;
  }

  if (state.mode === "meters") {
    return state.meterW > 0 && state.meterH > 0 ? state.meterW / state.meterH : 1;
  }

  const preset = ASPECT_PRESETS.find((candidate) => candidate.value === state.preset);

  return preset ? preset.aspect : 1;
}

export function describeAspect(state: AspectState) {
  if (state.mode === "pixels") {
    return `${state.pixelW}×${state.pixelH}px`;
  }

  if (state.mode === "meters") {
    return `${state.meterW}×${state.meterH}m`;
  }

  return state.preset;
}
