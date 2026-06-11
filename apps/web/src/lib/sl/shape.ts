export interface ShapeParamDriven {
  id: number
  min1: number
  max1: number
  max2: number
  min2: number
}

export interface ShapeParamBone {
  name: string
  scale: number[]
  offset?: number[]
}

export interface ShapeParamVolumeMorph {
  name: string
  scale: number[]
  pos?: number[]
}

export interface SLJointDef {
  name: string
  parent: string | null
  isVolume: boolean
  pos: number[]
  rot: number[]
  scale: number[]
  pivot: number[]
  end: number[]
  support: "base" | "extended"
  aliases: string[]
}

export interface ShapeParam {
  id: number
  name: string
  label: string
  wearable: string
  group: number
  editGroup: string
  editGroupOrder: number
  labelMin: string
  labelMax: string
  min: number
  max: number
  default: number
  sex: string
  kind: "morph" | "skeleton" | "driver" | "other"
  meshType?: string
  bones?: ShapeParamBone[]
  volumeMorphs?: ShapeParamVolumeMorph[]
  driven?: ShapeParamDriven[]
  camera?: { distance?: number; elevation?: number; angle?: number }
}

export interface AvatarSkin {
  joints: string[]
  offset: number
  count: number
}

// base.bin records are 8 floats per vertex: position, normal, uv
export interface AvatarData {
  meshes: Record<string, string>
  params: ShapeParam[]
  byId: Map<number, ShapeParam>
  morphManifest: Record<string, { offset: number; count: number }>
  morphFloats: Float32Array
  morphIndices: Uint32Array
  skins: Record<string, AvatarSkin>
  skinFloats: Float32Array
  base: Record<string, { offset: number; count: number }>
  baseFloats: Float32Array
  faces: Record<string, { offset: number; count: number }>
  faceIndices: Uint16Array
  skeleton: SLJointDef[]
}

export type ShapeValues = Record<number, number>

export const SHAPE_GROUPS = [
  { key: "shape_body", label: "Body" },
  { key: "shape_torso", label: "Torso" },
  { key: "shape_legs", label: "Legs" },
  { key: "shape_head", label: "Head" },
  { key: "shape_eyes", label: "Eyes" },
  { key: "shape_ears", label: "Ears" },
  { key: "shape_nose", label: "Nose" },
  { key: "shape_mouth", label: "Mouth" },
  { key: "shape_chin", label: "Chin" },
] as const

export type ShapeGroupKey = (typeof SHAPE_GROUPS)[number]["key"]

export const SEX_PARAM_ID = 80

export async function loadAvatarData(baseUrl = "/avatar"): Promise<AvatarData> {
  const [paramsResponse, morphsResponse, weightsResponse, baseResponse, facesResponse] =
    await Promise.all([
      fetch(`${baseUrl}/params.json`),
      fetch(`${baseUrl}/morphs.bin`),
      fetch(`${baseUrl}/weights.bin`),
      fetch(`${baseUrl}/base.bin`),
      fetch(`${baseUrl}/faces.bin`),
    ])

  if (
    !paramsResponse.ok ||
    !morphsResponse.ok ||
    !weightsResponse.ok ||
    !baseResponse.ok ||
    !facesResponse.ok
  ) {
    throw new Error("failed to load avatar data")
  }

  const json = await paramsResponse.json()
  const morphBuffer = await morphsResponse.arrayBuffer()
  const weightsBuffer = await weightsResponse.arrayBuffer()
  const baseBuffer = await baseResponse.arrayBuffer()
  const facesBuffer = await facesResponse.arrayBuffer()

  const params = json.params as ShapeParam[]
  const byId = new Map<number, ShapeParam>()

  for (const param of params) {
    byId.set(param.id, param)
  }

  return {
    meshes: json.meshes,
    params,
    byId,
    morphManifest: json.morphs,
    morphFloats: new Float32Array(morphBuffer),
    morphIndices: new Uint32Array(morphBuffer),
    skins: json.skins,
    skinFloats: new Float32Array(weightsBuffer),
    base: json.base,
    baseFloats: new Float32Array(baseBuffer),
    faces: json.faces,
    faceIndices: new Uint16Array(facesBuffer),
    skeleton: json.skeleton,
  }
}

export function editableParams(data: AvatarData): ShapeParam[] {
  return data.params.filter(
    (param) =>
      param.wearable === "shape" && param.group === 0 && param.editGroup.startsWith("shape_"),
  )
}

export function paramsForGroup(data: AvatarData, group: ShapeGroupKey): ShapeParam[] {
  return editableParams(data)
    .filter((param) => param.editGroup === group)
    .sort((left, right) => left.editGroupOrder - right.editGroupOrder)
}

export function defaultShapeValues(data: AvatarData): ShapeValues {
  const values: ShapeValues = {}

  for (const param of editableParams(data)) {
    values[param.id] = param.default
  }

  values[SEX_PARAM_ID] = 0

  return values
}

export function clampParamValue(param: ShapeParam, value: number): number {
  return Math.min(Math.max(value, param.min), param.max)
}

export function valueToU8(param: ShapeParam, value: number): number {
  const clamped = clampParamValue(param, value)

  if (param.max === param.min) {
    return 0
  }

  return Math.floor(((clamped - param.min) / (param.max - param.min)) * 255)
}

export interface ParsedShape {
  name: string | null
  values: ShapeValues
}

export function parseShapeXml(text: string, data: AvatarData): ParsedShape {
  const doc = new DOMParser().parseFromString(text, "text/xml")

  if (doc.querySelector("parsererror")) {
    throw new Error("Not a valid XML file")
  }

  const root = doc.documentElement

  if (root.tagName !== "linden_genepool") {
    throw new Error("Not an appearance XML file (missing linden_genepool root)")
  }

  const archetype = root.querySelector("archetype")

  if (!archetype) {
    throw new Error("Appearance XML is missing its archetype node")
  }

  const archetypeName = archetype.getAttribute("name")
  const values: ShapeValues = {}

  for (const node of archetype.querySelectorAll("param")) {
    const id = Number(node.getAttribute("id"))
    const value = Number(node.getAttribute("value"))

    if (Number.isNaN(id) || Number.isNaN(value)) {
      continue
    }

    const param = data.byId.get(id)

    if (!param || param.wearable !== "shape") {
      continue
    }

    if (param.group === 0 || id === SEX_PARAM_ID) {
      values[id] = clampParamValue(param, value)
    }
  }

  if (Object.keys(values).length === 0) {
    throw new Error("No shape parameters found in this file")
  }

  return { name: archetypeName === "???" ? null : archetypeName, values }
}

export function serializeShapeXml(values: ShapeValues, data: AvatarData, name = "shape"): string {
  const weights = evaluateWeights(values, data)
  const lines: string[] = [
    `<?xml version="1.0" encoding="US-ASCII" standalone="yes"?>`,
    `<linden_genepool version="1.0">`,
    `\t<archetype name="${name.replace(/[<>&"]/g, "")}">`,
  ]

  const shapeParams = data.params
    .filter((param) => param.wearable === "shape")
    .sort((left, right) => left.id - right.id)

  for (const param of shapeParams) {
    const value = weights.get(param.id) ?? param.default
    const u8 = valueToU8(param, value)

    lines.push(
      `\t\t<param id="${param.id}" name="${param.name}" value="${value.toFixed(3)}" u8="${u8}"/>`,
    )
  }

  lines.push(`\t</archetype>`, `</linden_genepool>`, ``)

  return lines.join("\n")
}

function drivenWeight(
  driver: ShapeParam,
  driven: ShapeParamDriven,
  target: ShapeParam,
  inputWeight: number,
): number {
  if (inputWeight <= driven.min1) {
    if (driven.min1 === driven.max1 && driven.min1 <= driver.min) {
      return target.max
    }

    return target.min
  }

  if (inputWeight <= driven.max1) {
    const t = (inputWeight - driven.min1) / (driven.max1 - driven.min1)

    return target.min + t * (target.max - target.min)
  }

  if (inputWeight <= driven.max2) {
    return target.max
  }

  if (inputWeight <= driven.min2) {
    const t = (inputWeight - driven.max2) / (driven.min2 - driven.max2)

    return target.max + t * (target.min - target.max)
  }

  if (driven.max2 >= driver.max) {
    return target.max
  }

  return target.min
}

export function evaluateWeights(values: ShapeValues, data: AvatarData): Map<number, number> {
  const weights = new Map<number, number>()

  for (const param of data.params) {
    const value = values[param.id]

    if (value !== undefined) {
      weights.set(param.id, clampParamValue(param, value))
    } else {
      weights.set(param.id, param.default)
    }
  }

  for (let pass = 0; pass < 3; pass++) {
    let changed = false

    for (const param of data.params) {
      if (!param.driven || param.driven.length === 0) {
        continue
      }

      const inputWeight = weights.get(param.id) ?? param.default

      for (const driven of param.driven) {
        const target = data.byId.get(driven.id)

        if (!target) {
          continue
        }

        const next = drivenWeight(param, driven, target, inputWeight)

        if (weights.get(driven.id) !== next) {
          weights.set(driven.id, next)
          changed = true
        }
      }
    }

    if (!changed) {
      break
    }
  }

  return weights
}

export interface AvatarPose {
  weights: Map<number, number>
  morphWeights: Map<string, number>
}

// Sex-mismatched params apply at their default weight, not zero
// (llpolyskeletaldistortion.cpp:191, llpolymorph.cpp:564)
export function effectiveWeights(values: ShapeValues, data: AvatarData): Map<number, number> {
  const weights = evaluateWeights(values, data)
  const sex = (weights.get(SEX_PARAM_ID) ?? 0) >= 0.5 ? "male" : "female"

  for (const param of data.params) {
    if (param.sex !== "both" && param.sex !== sex) {
      weights.set(param.id, param.default)
    }
  }

  return weights
}

export function computePose(values: ShapeValues, data: AvatarData): AvatarPose {
  const weights = effectiveWeights(values, data)
  const morphWeights = new Map<string, number>()

  const meshesByType = new Map<string, string[]>()

  for (const [glbName, meshType] of Object.entries(data.meshes)) {
    const list = meshesByType.get(meshType) ?? []

    list.push(glbName)
    meshesByType.set(meshType, list)
  }

  for (const param of data.params) {
    if (param.kind !== "morph" || !param.meshType) {
      continue
    }

    const weight = weights.get(param.id) ?? 0

    for (const glbName of meshesByType.get(param.meshType) ?? []) {
      const key = `${glbName}:${param.name}`

      if (data.morphManifest[key]) {
        morphWeights.set(key, (morphWeights.get(key) ?? 0) + weight)
      }
    }
  }

  return { weights, morphWeights }
}

export function blendShapeValues(
  base: ShapeValues,
  source: ShapeValues,
  amount: number,
  data: AvatarData,
  paramIds?: Set<number>,
): ShapeValues {
  const result: ShapeValues = { ...base }

  for (const param of editableParams(data)) {
    if (paramIds && !paramIds.has(param.id)) {
      continue
    }

    const baseValue = base[param.id] ?? param.default
    const sourceValue = source[param.id] ?? param.default

    result[param.id] = baseValue + (sourceValue - baseValue) * amount
  }

  return result
}
