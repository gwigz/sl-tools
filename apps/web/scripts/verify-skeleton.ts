import { resolve } from "node:path"
import type { AvatarData, ShapeParam, ShapeValues, SLJointDef } from "../src/lib/sl/shape"
import { effectiveWeights, evaluateWeights, serializeShapeXml } from "../src/lib/sl/shape"
import { mayaQuatXYZ, rotateVec, SLSkeleton } from "../src/lib/sl/skeleton"

const PARAMS_PATH = resolve(import.meta.dir, "../public/avatar/params.json")

let failures = 0

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`ok   ${label}`)
  } else {
    failures++
    console.error(`FAIL ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function approx(actual: number, expected: number, epsilon = 1e-6) {
  return Math.abs(actual - expected) <= epsilon
}

interface ParamsJson {
  version: number
  params: ShapeParam[]
  skeleton: SLJointDef[]
}

function makeData(json: ParamsJson): AvatarData {
  const params = json.params
  const byId = new Map<number, ShapeParam>()

  for (const param of params) {
    byId.set(param.id, param)
  }

  return { params, byId, skeleton: json.skeleton } as AvatarData
}

function buildSkeleton(data: AvatarData, values: ShapeValues): SLSkeleton {
  const skeleton = new SLSkeleton(data.skeleton as SLJointDef[])

  skeleton.applyParams(effectiveWeights(values, data), data.params)

  return skeleton
}

function defaultValues(data: AvatarData, sex: number): ShapeValues {
  const values: ShapeValues = {}

  for (const param of data.params) {
    if (param.wearable === "shape" && param.group === 0) {
      values[param.id] = param.default
    }
  }

  values[80] = sex

  return values
}

// Leg bones carry no rotation, so mFootLeft's world z must equal the chain of
// local z offsets each scaled by its parent's local scale. indra's
// pelvisToFoot intentionally adds (not subtracts) the hip offset
// (llavatarappearance.cpp:528-531) — the well-known SL foot-sink quirk — so it
// differs from the world-space delta by exactly 2 * hip.z * pelvisScale.z.
function legChainConsistent(skeleton: SLSkeleton, pelvisToFoot: number): boolean {
  const pelvis = skeleton.joint("mPelvis")
  const hip = skeleton.joint("mHipLeft")
  const knee = skeleton.joint("mKneeLeft")
  const ankle = skeleton.joint("mAnkleLeft")
  const foot = skeleton.joint("mFootLeft")

  if (!pelvis || !hip || !knee || !ankle || !foot) {
    return false
  }

  const expectedFootZ =
    pelvis.worldPos[2] +
    hip.localPos[2] * pelvis.localScale[2] +
    knee.localPos[2] * hip.localScale[2] +
    ankle.localPos[2] * knee.localScale[2] +
    foot.localPos[2] * ankle.localScale[2]

  const expectedDelta = pelvisToFoot - 2 * hip.localPos[2] * pelvis.localScale[2]

  return (
    approx(foot.worldPos[2], expectedFootZ, 1e-5) &&
    approx(pelvis.worldPos[2] - foot.worldPos[2], expectedDelta, 1e-5)
  )
}

function lcg(seed: number) {
  let state = seed

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0

    return state / 0xffffffff
  }
}

async function main() {
  const json = (await Bun.file(PARAMS_PATH).json()) as ParamsJson

  check("params.json is version 3", json.version === 3)

  const data = makeData(json)
  const defs = data.skeleton as SLJointDef[]

  check(
    "skeleton table has mRoot + 133 bones + 26 collision volumes",
    defs.filter((def) => !def.isVolume).length === 134 &&
      defs.filter((def) => def.isVolume).length === 26 &&
      defs[0].name === "mRoot",
    `got ${defs.filter((def) => !def.isVolume).length} + ${defs.filter((def) => def.isVolume).length}`,
  )

  {
    const pelvis = defs.find((def) => def.name === "mPelvis")

    check(
      "mPelvis is zeroed under mRoot with its skin pivot intact (SL-315)",
      pelvis !== undefined &&
        pelvis.parent === "mRoot" &&
        pelvis.pos.every((value) => value === 0) &&
        approx(pelvis.pivot[2], 1.067015),
    )
  }

  {
    // mayaQ XYZ applies X about fixed axes first: e_z -> Rx(90) -> -e_y -> Ry(90) -> -e_y
    const rotated = rotateVec(mayaQuatXYZ(90, 90, 0), [0, 0, 1])

    check(
      "mayaQuatXYZ applies X first",
      approx(rotated[0], 0) && approx(rotated[1], -1) && approx(rotated[2], 0),
      `got [${rotated.map((value) => value.toFixed(4)).join(", ")}]`,
    )
  }

  if (process.argv.includes("--dump")) {
    const skeleton = buildSkeleton(data, defaultValues(data, 0))
    const { pelvisToFoot, height } = skeleton.computeBodySize()

    console.log(`pelvisToFoot ${pelvisToFoot.toFixed(6)} height ${height.toFixed(6)}`)

    for (const joint of skeleton.ordered) {
      console.log(
        `${joint.isVolume ? "CV  " : "bone"} ${joint.name.padEnd(24)} ` +
          `pos [${joint.worldPos.map((value) => value.toFixed(6)).join(", ")}] ` +
          `scale [${joint.localScale.map((value) => value.toFixed(6)).join(", ")}]`,
      )
    }

    return
  }

  for (const sex of [0, 1]) {
    const label = sex === 1 ? "male" : "female"
    const skeleton = buildSkeleton(data, defaultValues(data, sex))
    const { pelvisToFoot, height } = skeleton.computeBodySize()

    check(
      `${label} default height is plausible (${height.toFixed(4)}m)`,
      height > 1.4 && height < 2.2,
    )

    const footLeft = skeleton.joint("mFootLeft")
    const footRight = skeleton.joint("mFootRight")

    check(
      `${label} pelvisToFoot relates to world positions per the indra formula`,
      legChainConsistent(skeleton, pelvisToFoot),
    )

    // the official skeleton itself is ~2mm asymmetric, so allow 5mm
    check(
      `${label} feet are left/right symmetric within skeleton tolerance`,
      footLeft !== undefined &&
        footRight !== undefined &&
        approx(footLeft.worldPos[1], -footRight.worldPos[1], 5e-3) &&
        approx(footLeft.worldPos[2], footRight.worldPos[2], 5e-3),
    )
  }

  {
    const random = lcg(12345)

    for (let trial = 0; trial < 5; trial++) {
      const values = defaultValues(data, trial % 2)

      for (const param of data.params) {
        if (param.wearable === "shape" && param.group === 0) {
          values[param.id] = param.min + (param.max - param.min) * random()
        }
      }

      const skeleton = buildSkeleton(data, values)
      const { pelvisToFoot } = skeleton.computeBodySize()

      check(
        `random shape ${trial} keeps the leg-chain composition consistent`,
        legChainConsistent(skeleton, pelvisToFoot),
      )
    }
  }

  {
    // hand-evaluate one skeleton param: scale deltas accumulate onto localScale
    const heightParam = data.params.find(
      (param) => param.kind === "skeleton" && param.name === "Height",
    )

    check("found the Height skeleton param", heightParam !== undefined)

    if (heightParam?.bones) {
      const values = defaultValues(data, 0)

      values[heightParam.id] = heightParam.max

      const weights = effectiveWeights(values, data)
      const skeleton = new SLSkeleton(defs)

      skeleton.applyParams(weights, data.params)

      const sample = heightParam.bones[0]
      const joint = skeleton.joint(sample.name)
      const def = defs.find((entry) => entry.name === sample.name)

      let expected = def ? def.scale[2] : 0

      for (const param of data.params) {
        if (param.kind !== "skeleton" || !param.bones) {
          continue
        }

        for (const bone of param.bones) {
          if (bone.name === sample.name) {
            expected += (weights.get(param.id) ?? param.default) * bone.scale[2]
          }
        }
      }

      check(
        `Height at max scales ${sample.name} as hand-computed`,
        joint !== undefined && approx(joint.localScale[2], expected, 1e-6),
        `got ${joint?.localScale[2].toFixed(6)} expected ${expected.toFixed(6)}`,
      )
    }
  }

  {
    // collision volumes inherit composed scale: cv delta = cvDefault ⊙ boneDelta
    const torsoParams = data.params.filter(
      (param) =>
        param.kind === "skeleton" &&
        param.bones?.some((bone) => bone.name === "mTorso") &&
        param.max > 0,
    )

    check("found a torso-scaling skeleton param", torsoParams.length > 0)

    if (torsoParams.length > 0) {
      const belly = defs.find((def) => def.name === "BELLY")
      const values = defaultValues(data, 0)

      for (const param of torsoParams) {
        values[param.id] = param.max
      }

      const weights = effectiveWeights(values, data)
      const skeleton = new SLSkeleton(defs)

      skeleton.applyParams(weights, data.params)

      let expected = belly ? belly.scale[2] : 0

      for (const param of data.params) {
        const weight = weights.get(param.id) ?? param.default

        if (param.kind === "skeleton" && param.bones) {
          for (const bone of param.bones) {
            if (bone.name === "mTorso" && belly) {
              expected += weight * belly.scale[2] * bone.scale[2]
            }
          }
        }

        if (param.volumeMorphs) {
          for (const volume of param.volumeMorphs) {
            if (volume.name === "BELLY") {
              expected += weight * volume.scale[2]
            }
          }
        }
      }

      const bellyJoint = skeleton.joint("BELLY")

      check(
        "BELLY collision volume composes inherited + volume-morph scale",
        bellyJoint !== undefined && approx(bellyJoint.localScale[2], expected, 1e-6),
        `got ${bellyJoint?.localScale[2].toFixed(6)} expected ${expected.toFixed(6)}`,
      )
    }
  }

  {
    // breast size must move the pec volumes through driven volume morphs
    const breastParam = data.params.find((param) => param.name === "Breast Size")

    check("found the Breast_Size param", breastParam !== undefined)

    if (breastParam) {
      const low = defaultValues(data, 0)
      const high = defaultValues(data, 0)

      low[breastParam.id] = breastParam.min
      high[breastParam.id] = breastParam.max

      const lowPec = buildSkeleton(data, low).joint("LEFT_PEC")
      const highPec = buildSkeleton(data, high).joint("LEFT_PEC")

      check(
        "Breast_Size deforms the LEFT_PEC collision volume",
        lowPec !== undefined &&
          highPec !== undefined &&
          (!approx(lowPec.localScale[0], highPec.localScale[0], 1e-9) ||
            !approx(lowPec.localPos[0], highPec.localPos[0], 1e-9)),
      )
    }
  }

  {
    // sex-mismatched params apply at their default weight, not zero
    const maleParam = data.params.find(
      (param) => param.sex === "male" && param.default !== 0 && param.kind !== "driver",
    )

    if (maleParam) {
      const values = defaultValues(data, 0)

      values[maleParam.id] = maleParam.max

      const weights = effectiveWeights(values, data)

      check(
        `female avatar pins male param ${maleParam.name} to its default`,
        approx(weights.get(maleParam.id) ?? Number.NaN, maleParam.default),
        `got ${weights.get(maleParam.id)} expected ${maleParam.default}`,
      )
    } else {
      const anyMale = data.params.find((param) => param.sex === "male")

      check("found a sex-gated param to test", anyMale !== undefined)

      if (anyMale) {
        const values = defaultValues(data, 0)

        values[anyMale.id] = anyMale.max

        const weights = effectiveWeights(values, data)

        check(
          `female avatar pins male param ${anyMale.name} to its default`,
          approx(weights.get(anyMale.id) ?? Number.NaN, anyMale.default),
        )
      }
    }
  }

  {
    const values = defaultValues(data, 0)
    const torso = data.params.find(
      (param) => param.name === "Torso Muscles" && param.sex === "female",
    )

    if (torso) {
      values[torso.id] = torso.max
    }

    const xml = serializeShapeXml(values, data, "verify")
    const paramPattern = /<param id="(\d+)" name="[^"]*" value="(-?[\d.]+)" u8="(\d+)"\/>/g
    const exported = new Map<number, { value: number; u8: number }>()

    let match = paramPattern.exec(xml)

    while (match) {
      exported.set(Number(match[1]), { value: Number(match[2]), u8: Number(match[3]) })
      match = paramPattern.exec(xml)
    }

    const shapeParams = data.params.filter((param) => param.wearable === "shape")
    const exportedIds = [...exported.keys()]
    const sorted = exportedIds.every((id, index) => index === 0 || id > exportedIds[index - 1])

    check(
      `export contains all ${shapeParams.length} shape params sorted by id`,
      exported.size === shapeParams.length && sorted,
      `got ${exported.size}`,
    )

    // F32_to_U8 is floor-based (llquantize.h:99, used by dump_visual_param):
    // Height (id 33, range -2.3..2) at 0 -> floor(2.3 / 4.3 * 255) = 136
    check(
      "u8 quantization matches indra F32_to_U8",
      exported.get(33)?.u8 === 136 && exported.get(105)?.u8 === 127,
      `got ${exported.get(33)?.u8} and ${exported.get(105)?.u8}`,
    )

    const weights = evaluateWeights(values, data)
    const drivenOk = [...exported.entries()].every(([id, entry]) => {
      const weight = weights.get(id)

      return weight === undefined || Math.abs(entry.value - weight) <= 5e-4
    })

    check("exported values match driver-propagated weights to 3 decimals", drivenOk)

    // round-trip: re-importing the group-0 params reproduces the same file
    const reimported: ShapeValues = {}

    for (const [id, entry] of exported) {
      const param = data.byId.get(id)

      if (param && (param.group === 0 || id === 80)) {
        reimported[id] = entry.value
      }
    }

    check(
      "export -> import -> export round-trips identically",
      serializeShapeXml(reimported, data, "verify") === xml,
    )
  }

  {
    // an active position override pins local position against param offsets
    const skeleton = new SLSkeleton(defs)
    const knee = skeleton.joint("mKneeLeft")

    if (knee) {
      knee.posOverride = [0.1, 0.2, 0.3]
    }

    skeleton.applyParams(effectiveWeights(defaultValues(data, 0), data), data.params)

    check(
      "position override pins mKneeLeft local position",
      knee !== undefined &&
        approx(knee.localPos[0], 0.1) &&
        approx(knee.localPos[1], 0.2) &&
        approx(knee.localPos[2], 0.3),
    )
  }

  console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
