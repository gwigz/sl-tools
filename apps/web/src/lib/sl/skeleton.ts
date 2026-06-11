import type { ShapeParam, SLJointDef } from "./shape"

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]

const DEG_TO_RAD = Math.PI / 180

// LLQuaternion mayaQ(x, y, z, XYZ) applies X first about fixed axes
// (llquaternion.cpp:760), which is Hamilton qz * qy * qx
export function mayaQuatXYZ(degreesX: number, degreesY: number, degreesZ: number): Quat {
  const halfX = (degreesX * DEG_TO_RAD) / 2
  const halfY = (degreesY * DEG_TO_RAD) / 2
  const halfZ = (degreesZ * DEG_TO_RAD) / 2

  const cosX = Math.cos(halfX)
  const sinX = Math.sin(halfX)
  const cosY = Math.cos(halfY)
  const sinY = Math.sin(halfY)
  const cosZ = Math.cos(halfZ)
  const sinZ = Math.sin(halfZ)

  return [
    sinX * cosY * cosZ - cosX * sinY * sinZ,
    cosX * sinY * cosZ + sinX * cosY * sinZ,
    cosX * cosY * sinZ - sinX * sinY * cosZ,
    cosX * cosY * cosZ + sinX * sinY * sinZ,
  ]
}

// Hamilton product: rotation b followed by rotation a
export function mulQuat(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ]
}

export function invQuat(quat: Quat): Quat {
  return [-quat[0], -quat[1], -quat[2], quat[3]]
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const half = angle / 2
  const sin = Math.sin(half)

  return [axis[0] * sin, axis[1] * sin, axis[2] * sin, Math.cos(half)]
}

export function shortestArcQuat(from: Vec3, to: Vec3): Quat {
  const fromLength = Math.hypot(from[0], from[1], from[2])
  const toLength = Math.hypot(to[0], to[1], to[2])

  if (fromLength < 1e-8 || toLength < 1e-8) {
    return [0, 0, 0, 1]
  }

  const fx = from[0] / fromLength
  const fy = from[1] / fromLength
  const fz = from[2] / fromLength
  const tx = to[0] / toLength
  const ty = to[1] / toLength
  const tz = to[2] / toLength

  const dot = fx * tx + fy * ty + fz * tz

  if (dot < -0.999999) {
    const axis: Vec3 = Math.abs(fx) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    const cx = fy * axis[2] - fz * axis[1]
    const cy = fz * axis[0] - fx * axis[2]
    const cz = fx * axis[1] - fy * axis[0]
    const length = Math.hypot(cx, cy, cz)

    return [cx / length, cy / length, cz / length, 0]
  }

  const cx = fy * tz - fz * ty
  const cy = fz * tx - fx * tz
  const cz = fx * ty - fy * tx
  const w = 1 + dot
  const norm = Math.hypot(cx, cy, cz, w)

  return [cx / norm, cy / norm, cz / norm, w / norm]
}

export function rotateVec(quat: Quat, vec: Vec3): Vec3 {
  const [qx, qy, qz, qw] = quat
  const [vx, vy, vz] = vec

  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)

  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ]
}

export class SLJoint {
  name: string
  isVolume: boolean
  support: "base" | "extended"
  aliases: string[]
  parent: SLJoint | null = null
  children: SLJoint[] = []

  defaultPos: Vec3
  defaultScale: Vec3
  pivot: Vec3
  localRot: Quat

  localPos: Vec3
  localScale: Vec3
  posOverride: Vec3 | null = null
  poseRot: Quat | null = null
  presetRot: Quat | null = null

  worldPos: Vec3 = [0, 0, 0]
  worldRot: Quat = [0, 0, 0, 1]

  constructor(def: SLJointDef) {
    this.name = def.name
    this.isVolume = def.isVolume
    this.support = def.support
    this.aliases = def.aliases
    this.defaultPos = [def.pos[0], def.pos[1], def.pos[2]]
    this.defaultScale = [def.scale[0], def.scale[1], def.scale[2]]
    this.pivot = [def.pivot[0], def.pivot[1], def.pivot[2]]
    this.localRot = mayaQuatXYZ(def.rot[0], def.rot[1], def.rot[2])
    this.localPos = [...this.defaultPos]
    this.localScale = [...this.defaultScale]
  }
}

export class SLSkeleton {
  ordered: SLJoint[] = []
  byName = new Map<string, SLJoint>()

  constructor(defs: SLJointDef[]) {
    for (const def of defs) {
      const joint = new SLJoint(def)

      if (def.parent) {
        const parent = this.byName.get(def.parent)

        if (parent) {
          joint.parent = parent
          parent.children.push(joint)
        }
      }

      this.ordered.push(joint)
      this.byName.set(def.name, joint)
    }
  }

  joint(name: string): SLJoint | undefined {
    return this.byName.get(name)
  }

  resetToDefaults() {
    for (const joint of this.ordered) {
      const pos = joint.posOverride ?? joint.defaultPos

      joint.localPos = [pos[0], pos[1], pos[2]]
      joint.localScale = [...joint.defaultScale]
    }
  }

  // LLPolySkeletalDistortion::apply + LLPolyMorphTarget::applyVolumeChanges,
  // re-evaluated absolutely from defaults each call
  applyParams(weights: Map<number, number>, params: ShapeParam[]) {
    this.resetToDefaults()

    for (const param of params) {
      const weight = weights.get(param.id) ?? param.default

      if (param.kind === "skeleton" && param.bones) {
        for (const bone of param.bones) {
          const joint = this.byName.get(bone.name)

          if (!joint) {
            continue
          }

          for (let axis = 0; axis < 3; axis++) {
            joint.localScale[axis] += weight * bone.scale[axis]
          }

          for (const child of joint.children) {
            if (child.isVolume) {
              for (let axis = 0; axis < 3; axis++) {
                child.localScale[axis] += weight * child.defaultScale[axis] * bone.scale[axis]
              }
            }
          }

          if (bone.offset && !joint.posOverride) {
            for (let axis = 0; axis < 3; axis++) {
              joint.localPos[axis] += weight * bone.offset[axis]
            }
          }
        }
      }

      if (param.volumeMorphs) {
        for (const volume of param.volumeMorphs) {
          const joint = this.byName.get(volume.name)

          if (!joint) {
            continue
          }

          for (let axis = 0; axis < 3; axis++) {
            joint.localScale[axis] += weight * volume.scale[axis]
          }

          if (volume.pos && !joint.posOverride) {
            for (let axis = 0; axis < 3; axis++) {
              joint.localPos[axis] += weight * volume.pos[axis]
            }
          }
        }
      }
    }

    this.updateWorld()
  }

  // LLXformMatrix::update (xform.cpp:69-93): scale is never inherited; the
  // parent's scale only stretches the child's local offset. poseRot plays the
  // role of an animation rotation on the joint (custom rigs authored away
  // from the SL rest pose); presetRot is a user-selected preview pose that
  // replaces it per joint, like an animation would in the viewer.
  updateWorld() {
    for (const joint of this.ordered) {
      const parent = joint.parent
      const animRot = joint.presetRot ?? joint.poseRot
      const localRot = animRot ? mulQuat(animRot, joint.localRot) : joint.localRot

      if (parent) {
        const scaledOffset: Vec3 = [
          joint.localPos[0] * parent.localScale[0],
          joint.localPos[1] * parent.localScale[1],
          joint.localPos[2] * parent.localScale[2],
        ]
        const rotated = rotateVec(parent.worldRot, scaledOffset)

        joint.worldPos = [
          parent.worldPos[0] + rotated[0],
          parent.worldPos[1] + rotated[1],
          parent.worldPos[2] + rotated[2],
        ]
        joint.worldRot = mulQuat(parent.worldRot, localRot)
      } else {
        joint.worldPos = [...joint.localPos]
        joint.worldRot = [...localRot]
      }
    }
  }

  baseAncestor(joint: SLJoint): SLJoint {
    let ancestor = joint.parent ?? joint

    while (ancestor.parent && ancestor.support !== "base") {
      ancestor = ancestor.parent
    }

    return ancestor
  }

  // totalSkinOffset (llavatarjointmesh.cpp:65): pivots summed over the
  // support="base" ancestor chain, joint included
  pivotSum(name: string): Vec3 {
    const total: Vec3 = [0, 0, 0]

    let joint = this.byName.get(name) ?? null

    while (joint) {
      if (joint.support === "base") {
        total[0] += joint.pivot[0]
        total[1] += joint.pivot[1]
        total[2] += joint.pivot[2]
      }

      joint = joint.parent
    }

    return total
  }

  // LLAvatarAppearance::computeBodySize (llavatarappearance.cpp:471-556)
  computeBodySize(): { pelvisToFoot: number; height: number } {
    const positionZ = (name: string) => this.byName.get(name)?.localPos[2] ?? 0
    const scaleZ = (name: string) => this.byName.get(name)?.localScale[2] ?? 1

    const pelvisToFoot =
      positionZ("mHipLeft") * scaleZ("mPelvis") -
      positionZ("mKneeLeft") * scaleZ("mHipLeft") -
      positionZ("mAnkleLeft") * scaleZ("mKneeLeft") -
      positionZ("mFootLeft") * scaleZ("mAnkleLeft")

    const height =
      pelvisToFoot +
      Math.SQRT2 * positionZ("mSkull") * scaleZ("mHead") +
      positionZ("mHead") * scaleZ("mNeck") +
      positionZ("mNeck") * scaleZ("mChest") +
      positionZ("mChest") * scaleZ("mTorso") +
      positionZ("mTorso") * scaleZ("mPelvis")

    return { pelvisToFoot, height }
  }
}

// SL (x, y, z) -> glTF (x, z, -y)
export function slVecToGltf(vec: Vec3): Vec3 {
  return [vec[0], vec[2], -vec[1]]
}

export function gltfVecToSl(vec: Vec3): Vec3 {
  return [vec[0], -vec[2], vec[1]]
}

export function slQuatToGltf(quat: Quat): Quat {
  return [quat[0], quat[2], -quat[1], quat[3]]
}

export function gltfQuatToSl(quat: Quat): Quat {
  return [quat[0], -quat[2], quat[1], quat[3]]
}

// Column-major T(worldPos) * R(worldRot) * S(localScale) in glTF space;
// equals indra's row-vector S * R * T (xform.cpp:93)
export function jointWorldMatrixGltf(joint: SLJoint, out: Float32Array) {
  const [px, py, pz] = slVecToGltf(joint.worldPos)
  const [qx, qy, qz, qw] = slQuatToGltf(joint.worldRot)
  const scale = joint.localScale
  const [sx, sy, sz] = [scale[0], scale[2], scale[1]]

  const xx = qx * qx
  const yy = qy * qy
  const zz = qz * qz
  const xy = qx * qy
  const xz = qx * qz
  const yz = qy * qz
  const wx = qw * qx
  const wy = qw * qy
  const wz = qw * qz

  out[0] = (1 - 2 * (yy + zz)) * sx
  out[1] = 2 * (xy + wz) * sx
  out[2] = 2 * (xz - wy) * sx
  out[3] = 0
  out[4] = 2 * (xy - wz) * sy
  out[5] = (1 - 2 * (xx + zz)) * sy
  out[6] = 2 * (yz + wx) * sy
  out[7] = 0
  out[8] = 2 * (xz + wy) * sz
  out[9] = 2 * (yz - wx) * sz
  out[10] = (1 - 2 * (xx + yy)) * sz
  out[11] = 0
  out[12] = px
  out[13] = py
  out[14] = pz
  out[15] = 1
}
