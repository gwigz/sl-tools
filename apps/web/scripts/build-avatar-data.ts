import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { XMLParser } from "fast-xml-parser"

const VIEWER_DIR = process.argv[2] ?? resolve(import.meta.dir, "../../../../viewer")
const OUT_DIR = resolve(import.meta.dir, "../public/avatar")

const CHARACTER_DIR = `${VIEWER_DIR}/indra/newview/character`

// Keys double as the lad <mesh type> names
const MESH_MAP: Record<string, { type: string; llm: string }> = {
  headMesh: { type: "headMesh", llm: "avatar_head" },
  upperBodyMesh: { type: "upperBodyMesh", llm: "avatar_upper_body" },
  lowerBodyMesh: { type: "lowerBodyMesh", llm: "avatar_lower_body" },
  eyeBallLeftMesh: { type: "eyeBallLeftMesh", llm: "avatar_eye" },
  eyeBallRightMesh: { type: "eyeBallRightMesh", llm: "avatar_eye" },
  eyelashMesh: { type: "eyelashMesh", llm: "avatar_eyelashes" },
}

interface LlmMorph {
  name: string
  indices: Uint32Array
  coords: Float32Array
  normals: Float32Array
}

interface LlmMesh {
  numVertices: number
  coords: Float32Array
  normals: Float32Array
  uvs: Float32Array
  faces: Uint16Array
  weights: Float32Array | null
  joints: string[]
  morphs: LlmMorph[]
}

function parseLlm(buffer: Buffer): LlmMesh {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  let offset = 24

  const hasWeights = view.getUint8(offset)
  const hasDetailTexCoords = view.getUint8(offset + 1)

  offset += 2 + 12 + 12 + 1 + 12

  const numVertices = view.getUint16(offset, true)

  offset += 2

  const readFloats = (count: number) => {
    const out = new Float32Array(count)

    for (let index = 0; index < count; index++) {
      out[index] = view.getFloat32(offset, true)
      offset += 4
    }

    return out
  }

  const coords = readFloats(numVertices * 3)
  const normals = readFloats(numVertices * 3)

  offset += numVertices * 12

  const uvs = readFloats(numVertices * 2)

  if (hasDetailTexCoords) {
    offset += numVertices * 8
  }

  let weights: Float32Array | null = null

  if (hasWeights) {
    weights = readFloats(numVertices)
  }

  const numFaces = view.getUint16(offset, true)

  offset += 2

  const faces = new Uint16Array(numFaces * 3)

  for (let index = 0; index < faces.length; index++) {
    faces[index] = view.getUint16(offset, true)
    offset += 2
  }

  const joints: string[] = []

  if (hasWeights) {
    const numJoints = view.getUint16(offset, true)

    offset += 2

    for (let index = 0; index < numJoints; index++) {
      const raw = buffer.subarray(offset, offset + 64)

      joints.push(raw.subarray(0, raw.indexOf(0)).toString())
      offset += 64
    }
  }

  const morphs: LlmMorph[] = []

  while (offset + 64 <= buffer.byteLength) {
    const nameBytes = buffer.subarray(offset, offset + 64)
    const name = nameBytes.subarray(0, nameBytes.indexOf(0)).toString()

    offset += 64

    if (name === "End Morphs") {
      break
    }

    const count = view.getInt32(offset, true)

    offset += 4

    const indices = new Uint32Array(count)
    const morphCoords = new Float32Array(count * 3)
    const morphNormals = new Float32Array(count * 3)

    for (let index = 0; index < count; index++) {
      indices[index] = view.getUint32(offset, true)

      for (let axis = 0; axis < 3; axis++) {
        morphCoords[index * 3 + axis] = view.getFloat32(offset + 4 + axis * 4, true)
        morphNormals[index * 3 + axis] = view.getFloat32(offset + 16 + axis * 4, true)
      }

      offset += 48
    }

    morphs.push({ name, indices, coords: morphCoords, normals: morphNormals })
  }

  return { numVertices, coords, normals, uvs, faces, weights, joints, morphs }
}

interface SkeletonBone {
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

function parseSkeleton(xml: string): SkeletonBone[] {
  const bones: SkeletonBone[] = []
  const stack: string[] = []
  const tagPattern = /<(bone|collision_volume)\b([^>]*?)(\/)?>|<\/bone>/g
  const attr = (body: string, name: string) => {
    const found = new RegExp(`${name}="([^"]+)"`).exec(body)

    return found ? found[1] : undefined
  }

  let match: RegExpExecArray | null = tagPattern.exec(xml)

  while (match) {
    if (match[0] === "</bone>") {
      stack.pop()
    } else {
      const body = match[2]
      const name = attr(body, "name") ?? ""
      const pos = parseVector(attr(body, "pos")) ?? [0, 0, 0]

      bones.push({
        name,
        parent: stack[stack.length - 1] ?? null,
        isVolume: match[1] === "collision_volume",
        pos,
        rot: parseVector(attr(body, "rot")) ?? [0, 0, 0],
        scale: parseVector(attr(body, "scale")) ?? [1, 1, 1],
        pivot: parseVector(attr(body, "pivot")) ?? pos,
        end: parseVector(attr(body, "end")) ?? [0, 0, 0],
        support: attr(body, "support") === "extended" ? "extended" : "base",
        aliases: (attr(body, "aliases") ?? "").split(/\s+/).filter(Boolean),
      })

      if (!match[3] && match[1] === "bone") {
        stack.push(name)
      }
    }

    match = tagPattern.exec(xml)
  }

  return bones
}

// Replicates LLAvatarJointMesh::setupJoint: walking the skeleton in order, each
// skin joint appends its nearest support="base" ancestor's matrix (deduped
// against the previous entry, per getBaseSkeletonAncestor) followed by its own.
// llm vertex weights index into this array, frac blending toward the next entry.
function buildRenderJoints(skinJoints: string[], skeleton: SkeletonBone[]): string[] {
  const byName = new Map<string, SkeletonBone>()

  for (const bone of skeleton) {
    byName.set(bone.name, bone)
  }

  const baseAncestor = (bone: SkeletonBone) => {
    let ancestor = bone.parent ? byName.get(bone.parent) : undefined

    while (ancestor?.parent && ancestor.support !== "base") {
      ancestor = byName.get(ancestor.parent)
    }

    return ancestor?.name ?? "mPelvis"
  }

  const skinSet = new Set(skinJoints)
  const entries: string[] = []

  for (const bone of skeleton) {
    if (!skinSet.has(bone.name)) {
      continue
    }

    const parentName = baseAncestor(bone)

    if (entries[entries.length - 1] !== parentName) {
      entries.push(parentName)
    }

    entries.push(bone.name)
  }

  return entries
}

function slToGltf(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y]
}

interface ParamJson {
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
  bones?: { name: string; scale: number[]; offset?: number[] }[]
  volumeMorphs?: { name: string; scale: number[]; pos?: number[] }[]
  driven?: { id: number; min1: number; max1: number; max2: number; min2: number }[]
  camera?: { distance?: number; elevation?: number; angle?: number }
}

function asArray<Type>(value: Type | Type[] | undefined): Type[] {
  if (value === undefined) {
    return []
  }

  if (Array.isArray(value)) {
    return value
  }

  return [value]
}

function parseVector(value: string | undefined): number[] | undefined {
  if (typeof value !== "string") {
    return undefined
  }

  const parts = value.trim().split(/\s+/).map(Number)

  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    return undefined
  }

  return parts
}

function parseParam(node: any, kind: ParamJson["kind"], meshType?: string): ParamJson | null {
  const id = Number(node["@_id"])

  if (Number.isNaN(id)) {
    return null
  }

  const min = Number(node["@_value_min"] ?? 0)
  const max = Number(node["@_value_max"] ?? 1)
  const fallback = Math.min(Math.max(0, min), max)
  const defaultValue =
    node["@_value_default"] !== undefined
      ? Math.min(Math.max(Number(node["@_value_default"]), min), max)
      : fallback

  const param: ParamJson = {
    id,
    name: String(node["@_name"] ?? ""),
    label: String(node["@_label"] ?? node["@_name"] ?? ""),
    wearable: String(node["@_wearable"] ?? ""),
    group: Number(node["@_group"] ?? 0),
    editGroup: String(node["@_edit_group"] ?? ""),
    editGroupOrder: Number(node["@_edit_group_order"] ?? 0),
    labelMin: String(node["@_label_min"] ?? ""),
    labelMax: String(node["@_label_max"] ?? ""),
    min,
    max,
    default: defaultValue,
    sex: String(node["@_sex"] ?? "both"),
    kind,
  }

  if (meshType) {
    param.meshType = meshType
  }

  if (node["@_camera_distance"] !== undefined) {
    param.camera = {
      distance: Number(node["@_camera_distance"]),
      elevation: Number(node["@_camera_elevation"] ?? 0),
      angle: Number(node["@_camera_angle"] ?? 0),
    }
  }

  if (kind === "skeleton") {
    const bones = asArray(node.param_skeleton?.bone)
      .map((bone: any) => {
        const scale = parseVector(bone["@_scale"]) ?? [0, 0, 0]
        const offset = parseVector(bone["@_offset"])
        const entry: { name: string; scale: number[]; offset?: number[] } = {
          name: String(bone["@_name"]),
          scale,
        }

        if (offset) {
          entry.offset = offset
        }

        return entry
      })
      .filter((bone) => bone.name)

    param.bones = bones
  }

  if (kind === "morph") {
    const volumes = asArray(node.param_morph?.volume_morph)
      .map((volume: any) => {
        const entry: { name: string; scale: number[]; pos?: number[] } = {
          name: String(volume["@_name"] ?? ""),
          scale: parseVector(volume["@_scale"]) ?? [0, 0, 0],
        }

        const pos = parseVector(volume["@_pos"])

        if (pos) {
          entry.pos = pos
        }

        return entry
      })
      .filter((volume) => volume.name)

    if (volumes.length > 0) {
      param.volumeMorphs = volumes
    }
  }

  if (kind === "driver") {
    param.driven = asArray(node.param_driver?.driven).map((driven: any) => ({
      id: Number(driven["@_id"]),
      min1: Number(driven["@_min1"] ?? min),
      max1: Number(driven["@_max1"] ?? max),
      max2: Number(driven["@_max2"] ?? driven["@_max1"] ?? max),
      min2: Number(driven["@_min2"] ?? driven["@_max1"] ?? max),
    }))
  }

  return param
}

async function main() {
  const ladXml = await Bun.file(`${CHARACTER_DIR}/avatar_lad.xml`).text()
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
  })
  const lad = parser.parse(ladXml).linden_avatar

  const params: ParamJson[] = []
  const seenIds = new Set<number>()

  const addParam = (param: ParamJson | null) => {
    if (param && !seenIds.has(param.id)) {
      seenIds.add(param.id)
      params.push(param)
    }
  }

  for (const node of asArray(lad.skeleton?.param)) {
    addParam(parseParam(node, "skeleton"))
  }

  for (const meshNode of asArray(lad.mesh)) {
    const meshType = String(meshNode["@_type"] ?? "")

    for (const node of asArray(meshNode.param)) {
      if (node.param_morph !== undefined) {
        addParam(parseParam(node, "morph", meshType))
      }
    }
  }

  for (const node of asArray(lad.driver_parameters?.param)) {
    addParam(parseParam(node, "driver"))
  }

  const parsedSkeleton = parseSkeleton(
    await Bun.file(`${CHARACTER_DIR}/avatar_skeleton.xml`).text(),
  )

  // The viewer parents mPelvis under a synthetic mRoot at the avatar origin
  // and zeroes its position at runtime (SL-315, llavatarappearance.cpp:878,
  // 1021); the pelvis pivot keeps its file value for skinning
  for (const bone of parsedSkeleton) {
    if (bone.name === "mPelvis") {
      bone.parent = "mRoot"
      bone.pos = [0, 0, 0]
    }
  }

  const skeleton: SkeletonBone[] = [
    {
      name: "mRoot",
      parent: null,
      isVolume: false,
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      scale: [1, 1, 1],
      pivot: [0, 0, 0],
      end: [0, 0, 0],
      support: "base",
      aliases: [],
    },
    ...parsedSkeleton,
  ]

  const llmCache = new Map<string, LlmMesh>()

  const loadLlm = async (name: string) => {
    let mesh = llmCache.get(name)

    if (!mesh) {
      const data = Buffer.from(await Bun.file(`${CHARACTER_DIR}/${name}.llm`).arrayBuffer())
      mesh = parseLlm(data)
      llmCache.set(name, mesh)
    }

    return mesh
  }

  const morphManifest: Record<string, { offset: number; count: number }> = {}
  const morphChunks: Float32Array[] = []
  const skinManifest: Record<string, { joints: string[]; offset: number; count: number }> = {}
  const skinChunks: Float32Array[] = []
  const baseManifest: Record<string, { offset: number; count: number }> = {}
  const baseChunks: Float32Array[] = []
  const faceManifest: Record<string, { offset: number; count: number }> = {}
  const faceChunks: Uint16Array[] = []

  let wordOffset = 0
  let skinWordOffset = 0
  let baseWordOffset = 0
  let faceOffset = 0

  // Geometry comes straight from the .llm files: positions and normals in
  // glTF axes (eyeballs stay joint-local — they are rigid joint meshes),
  // plus uvs and triangle indices. Vertex order is the .llm order, so skin
  // weights and morph indices need no remapping.
  for (const [meshName, source] of Object.entries(MESH_MAP)) {
    const llm = await loadLlm(source.llm)
    const vertexCount = llm.numVertices

    console.log(`${meshName}: ${vertexCount} verts, ${llm.faces.length / 3} tris (${source.llm})`)

    {
      const baseData = new Float32Array(vertexCount * 8)

      for (let vertex = 0; vertex < vertexCount; vertex++) {
        const [px, py, pz] = slToGltf(
          llm.coords[vertex * 3],
          llm.coords[vertex * 3 + 1],
          llm.coords[vertex * 3 + 2],
        )
        const [nx, ny, nz] = slToGltf(
          llm.normals[vertex * 3],
          llm.normals[vertex * 3 + 1],
          llm.normals[vertex * 3 + 2],
        )

        baseData[vertex * 8] = px
        baseData[vertex * 8 + 1] = py
        baseData[vertex * 8 + 2] = pz
        baseData[vertex * 8 + 3] = nx
        baseData[vertex * 8 + 4] = ny
        baseData[vertex * 8 + 5] = nz
        baseData[vertex * 8 + 6] = llm.uvs[vertex * 2]
        baseData[vertex * 8 + 7] = llm.uvs[vertex * 2 + 1]
      }

      baseChunks.push(baseData)
      baseManifest[meshName] = { offset: baseWordOffset, count: vertexCount }
      baseWordOffset += baseData.length

      faceChunks.push(llm.faces)
      faceManifest[meshName] = { offset: faceOffset, count: llm.faces.length }
      faceOffset += llm.faces.length
    }

    if (llm.weights && llm.joints.length > 0) {
      const renderJoints = buildRenderJoints(llm.joints, skeleton)
      const records = new Float32Array(vertexCount * 3)

      for (let vertex = 0; vertex < vertexCount; vertex++) {
        const weight = llm.weights[vertex]
        const lower = Math.min(Math.max(Math.floor(weight), 0), renderJoints.length - 1)
        const upper = Math.min(lower + 1, renderJoints.length - 1)

        records[vertex * 3] = lower
        records[vertex * 3 + 1] = upper
        records[vertex * 3 + 2] = weight - Math.floor(weight)
      }

      skinChunks.push(records)
      skinManifest[meshName] = {
        joints: renderJoints,
        offset: skinWordOffset,
        count: vertexCount,
      }
      skinWordOffset += records.length
    }

    const paramNames = new Set(
      params
        .filter((param) => param.kind === "morph" && param.meshType === source.type)
        .map((param) => param.name),
    )

    for (const morph of llm.morphs) {
      if (!paramNames.has(morph.name)) {
        continue
      }

      const records: number[] = []

      for (let index = 0; index < morph.indices.length; index++) {
        const [dx, dy, dz] = slToGltf(
          morph.coords[index * 3],
          morph.coords[index * 3 + 1],
          morph.coords[index * 3 + 2],
        )
        const [nx, ny, nz] = slToGltf(
          morph.normals[index * 3],
          morph.normals[index * 3 + 1],
          morph.normals[index * 3 + 2],
        )

        records.push(morph.indices[index], dx, dy, dz, nx, ny, nz)
      }

      if (records.length === 0) {
        continue
      }

      const chunk = new Float32Array(records)
      const indexView = new Uint32Array(chunk.buffer)

      for (let record = 0; record < records.length / 7; record++) {
        indexView[record * 7] = records[record * 7]
      }

      morphChunks.push(chunk)
      morphManifest[`${meshName}:${morph.name}`] = {
        offset: wordOffset,
        count: records.length / 7,
      }
      wordOffset += records.length
    }
  }

  await mkdir(OUT_DIR, { recursive: true })

  const totalWords = morphChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const binData = new Float32Array(totalWords)

  let writeOffset = 0

  for (const chunk of morphChunks) {
    binData.set(chunk, writeOffset)
    writeOffset += chunk.length
  }

  await Bun.write(`${OUT_DIR}/morphs.bin`, binData.buffer)

  const skinWords = skinChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const skinData = new Float32Array(skinWords)

  let skinWriteOffset = 0

  for (const chunk of skinChunks) {
    skinData.set(chunk, skinWriteOffset)
    skinWriteOffset += chunk.length
  }

  await Bun.write(`${OUT_DIR}/weights.bin`, skinData.buffer)

  const baseWords = baseChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const baseData = new Float32Array(baseWords)

  let baseWriteOffset = 0

  for (const chunk of baseChunks) {
    baseData.set(chunk, baseWriteOffset)
    baseWriteOffset += chunk.length
  }

  await Bun.write(`${OUT_DIR}/base.bin`, baseData.buffer)

  const faceWords = faceChunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const faceData = new Uint16Array(faceWords)

  let faceWriteOffset = 0

  for (const chunk of faceChunks) {
    faceData.set(chunk, faceWriteOffset)
    faceWriteOffset += chunk.length
  }

  await Bun.write(`${OUT_DIR}/faces.bin`, faceData.buffer)

  const meshTypes: Record<string, string> = {}

  for (const [meshName, source] of Object.entries(MESH_MAP)) {
    meshTypes[meshName] = source.type
  }

  await Bun.write(
    `${OUT_DIR}/params.json`,
    JSON.stringify({
      version: 3,
      meshes: meshTypes,
      params,
      morphs: morphManifest,
      skins: skinManifest,
      base: baseManifest,
      faces: faceManifest,
      skeleton,
    }),
  )

  const shapeParams = params.filter((param) => param.wearable === "shape" && param.group === 0)

  console.log(
    `params: ${params.length} total, ${shapeParams.length} editable shape sliders, ` +
      `${Object.keys(morphManifest).length} morph targets, ` +
      `morphs.bin ${((totalWords * 4) / 1024).toFixed(0)}kb`,
  )
}

await main()
