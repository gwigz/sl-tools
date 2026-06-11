import { proxy } from "valtio"

import {
  type AvatarData,
  blendShapeValues,
  defaultShapeValues,
  paramsForGroup,
  SEX_PARAM_ID,
  type ShapeGroupKey,
  type ShapeValues,
} from "~/lib/sl/shape"

export interface ImportedShape {
  id: string
  name: string
  values: ShapeValues
}

export interface GroupBlend {
  sourceId: string
  amount: number
}

export const state = proxy({
  shapes: [] as ImportedShape[],
  baseName: "Default",
  baseValues: {} as ShapeValues,
  overrides: {} as ShapeValues,
  blends: {} as Partial<Record<ShapeGroupKey, GroupBlend>>,
})

export type ShapeState = typeof state

export interface ShapeStateSnapshot {
  readonly shapes: readonly {
    readonly id: string
    readonly name: string
    readonly values: Readonly<ShapeValues>
  }[]
  readonly baseName: string
  readonly baseValues: Readonly<ShapeValues>
  readonly overrides: Readonly<ShapeValues>
  readonly blends: { readonly [key in ShapeGroupKey]?: Readonly<GroupBlend> }
}

export const ui = proxy({
  activeGroup: "shape_body" as ShapeGroupKey | null,
  hydrated: false,
  autoCamera: true,
  customRigName: null as string | null,
  posePreset: "default",
})

export interface PersistedShapeState {
  shapes: ImportedShape[]
  baseName: string
  baseValues: ShapeValues
  overrides: ShapeValues
  blends: Partial<Record<ShapeGroupKey, GroupBlend>>
}

export function snapshotForPersistence(snap: ShapeStateSnapshot): PersistedShapeState {
  return {
    shapes: snap.shapes.map((shape) => ({ ...shape, values: { ...shape.values } })),
    baseName: snap.baseName,
    baseValues: { ...snap.baseValues },
    overrides: { ...snap.overrides },
    blends: { ...snap.blends },
  }
}

export function restoreState(persisted: Partial<PersistedShapeState>, data: AvatarData) {
  state.shapes = persisted.shapes ?? []
  state.baseName = persisted.baseName ?? "Default"
  state.baseValues =
    persisted.baseValues && Object.keys(persisted.baseValues).length > 0
      ? persisted.baseValues
      : defaultShapeValues(data)
  state.overrides = persisted.overrides ?? {}
  state.blends = persisted.blends ?? {}
}

export function effectiveValues(snap: ShapeStateSnapshot, data: AvatarData): ShapeValues {
  let values: ShapeValues = { ...snap.baseValues }

  for (const [group, blend] of Object.entries(snap.blends)) {
    if (!blend) {
      continue
    }

    const source = snap.shapes.find((shape) => shape.id === blend.sourceId)

    if (!source) {
      continue
    }

    const ids = new Set(paramsForGroup(data, group as ShapeGroupKey).map((param) => param.id))

    values = blendShapeValues(values, source.values, blend.amount, data, ids)
  }

  return { ...values, ...snap.overrides }
}

export function captureState(): PersistedShapeState {
  const blends: Partial<Record<ShapeGroupKey, GroupBlend>> = {}

  for (const [group, blend] of Object.entries(state.blends)) {
    if (blend) {
      blends[group as ShapeGroupKey] = { ...blend }
    }
  }

  return {
    shapes: state.shapes.map((shape) => ({ ...shape, values: { ...shape.values } })),
    baseName: state.baseName,
    baseValues: { ...state.baseValues },
    overrides: { ...state.overrides },
    blends,
  }
}

export function restoreCaptured(saved: PersistedShapeState) {
  state.shapes = saved.shapes
  state.baseName = saved.baseName
  state.baseValues = saved.baseValues
  state.overrides = saved.overrides
  state.blends = saved.blends
}

export function setAsBase(shape: ImportedShape) {
  state.baseName = shape.name
  state.baseValues = { ...shape.values }
  state.overrides = {}
  state.blends = {}
}

export function resetToDefault(data: AvatarData) {
  state.baseName = "Default"
  state.baseValues = defaultShapeValues(data)
  state.overrides = {}
  state.blends = {}
}

export function removeShape(id: string) {
  state.shapes = state.shapes.filter((shape) => shape.id !== id)

  for (const [group, blend] of Object.entries(state.blends)) {
    if (blend?.sourceId === id) {
      delete state.blends[group as ShapeGroupKey]
    }
  }
}

export function setSex(male: boolean) {
  state.overrides[SEX_PARAM_ID] = male ? 1 : 0
}

export function currentSex(snap: ShapeStateSnapshot): "male" | "female" {
  const value = snap.overrides[SEX_PARAM_ID] ?? snap.baseValues[SEX_PARAM_ID] ?? 0

  return value >= 0.5 ? "male" : "female"
}
