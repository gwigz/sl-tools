import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

import type { AvatarData, AvatarPose, ShapeGroupKey } from "./shape"
import type { Quat, Vec3 } from "./skeleton"
import {
  gltfVecToSl,
  invQuat,
  jointWorldMatrixGltf,
  mayaQuatXYZ,
  mulQuat,
  quatFromAxisAngle,
  rotateVec,
  shortestArcQuat,
  SLSkeleton,
  slVecToGltf,
} from "./skeleton"

export type PoseRotations = Record<string, [number, number, number]>

// LLPolyMorphTarget::apply (llpolymorph.cpp:610)
const NORMAL_SOFTEN_FACTOR = 0.65

const HOVER_PARAM_ID = 11001

interface MorphableMesh {
  mesh: THREE.SkinnedMesh
  basePositions: Float32Array
  baseNormals: Float32Array
}

interface BoneRest {
  bone: THREE.Bone
  slName: string | null
  parentName: string | null
  worldPosition: THREE.Vector3
  worldQuaternion: THREE.Quaternion
  restMatrix: THREE.Matrix4
  correction: THREE.Matrix4 | null
}

// Two-joint .llm skin weights: each vertex blends between consecutive render
// joints, exactly like the SL system mesh skinning.
function applyAuthenticSkin(mesh: THREE.SkinnedMesh, data: AvatarData, meshName: string) {
  const skin = data.skins[meshName]

  if (!skin) {
    return
  }

  const boneIndexByName = new Map<string, number>()

  mesh.skeleton.bones.forEach((bone, index) => {
    boneIndexByName.set(bone.name, index)
  })

  const jointIndices = skin.joints.map((name) => boneIndexByName.get(name) ?? 0)
  const skinIndex = new Uint16Array(skin.count * 4)
  const skinWeight = new Float32Array(skin.count * 4)

  for (let vertex = 0; vertex < skin.count; vertex++) {
    const base = skin.offset + vertex * 3
    const lower = data.skinFloats[base]
    const upper = data.skinFloats[base + 1]
    const blend = data.skinFloats[base + 2]

    skinIndex[vertex * 4] = jointIndices[lower]
    skinIndex[vertex * 4 + 1] = jointIndices[upper]
    skinWeight[vertex * 4] = 1 - blend
    skinWeight[vertex * 4 + 1] = blend
  }

  mesh.geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4))
  mesh.geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4))
}

const FOCUS_PRESETS: Record<ShapeGroupKey, { target: [number, number, number]; distance: number }> =
  {
    shape_body: { target: [0, 0.95, 0], distance: 2.8 },
    shape_head: { target: [0, 1.72, 0], distance: 0.7 },
    shape_eyes: { target: [0, 1.74, 0], distance: 0.5 },
    shape_ears: { target: [0, 1.74, 0], distance: 0.6 },
    shape_nose: { target: [0, 1.72, 0], distance: 0.5 },
    shape_mouth: { target: [0, 1.68, 0], distance: 0.5 },
    shape_chin: { target: [0, 1.66, 0], distance: 0.55 },
    shape_torso: { target: [0, 1.25, 0], distance: 1.8 },
    shape_legs: { target: [0, 0.55, 0], distance: 2.2 },
  }

const HOME_TARGET = new THREE.Vector3(0, 0.95, 0)
const HOME_POSITION = new THREE.Vector3(1.4, 1.25, 2.4)

// Map keyed by canonical SL joint name when the bone matches one (directly or
// through avatar_skeleton.xml aliases, e.g. "avatar_mPelvis"), bone name otherwise
function captureBones(
  root: THREE.Object3D,
  resolveName: (name: string) => string | null,
): Map<string, BoneRest> {
  const bones = new Map<string, BoneRest>()

  root.updateMatrixWorld(true)

  root.traverse((object) => {
    if (object instanceof THREE.Bone) {
      const worldPosition = new THREE.Vector3()
      const worldQuaternion = new THREE.Quaternion()

      object.getWorldPosition(worldPosition)
      object.getWorldQuaternion(worldQuaternion)

      const slName = resolveName(object.name)

      bones.set(slName ?? object.name, {
        bone: object,
        slName,
        parentName: object.parent instanceof THREE.Bone ? object.parent.name : null,
        worldPosition,
        worldQuaternion,
        restMatrix: object.matrixWorld.clone(),
        correction: null,
      })

      object.matrixWorldAutoUpdate = false
    }
  })

  return bones
}

async function loadRigScene(url: string, fileName: string): Promise<THREE.Object3D> {
  if (fileName.toLowerCase().endsWith(".dae")) {
    const collada = await new ColladaLoader().loadAsync(url)

    if (!collada) {
      throw new Error("Failed to parse Collada file")
    }

    return collada.scene
  }

  const gltf = await new GLTFLoader().loadAsync(url)

  return gltf.scene
}

export class AvatarScene {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private controls: OrbitControls
  private root = new THREE.Group()
  private meshes = new Map<string, MorphableMesh>()
  private bones = new Map<string, BoneRest>()
  private slSkeleton: SLSkeleton | null = null
  private aliasMap = new Map<string, string>()
  private matrixScratch = new Float32Array(16)
  private ground: THREE.Mesh
  private ring: THREE.Mesh
  private vertexScratch = new THREE.Vector3()
  private posePreset: PoseRotations | null = null
  private defaultScene: THREE.Group | null = null
  private defaultBones = new Map<string, BoneRest>()
  private customScene: THREE.Object3D | null = null
  private animationFrame = 0
  private resizeObserver: ResizeObserver
  private focusTarget = new THREE.Vector3(0, 0.95, 0)
  private focusPosition = new THREE.Vector3(1.4, 1.25, 2.4)
  private focusActive = false
  private disposed = false

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.scene = new THREE.Scene()
    this.scene.add(this.root)

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50)
    this.camera.position.set(1.4, 1.25, 2.4)

    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.target.set(0, 0.95, 0)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.minDistance = 0.25
    this.controls.maxDistance = 8
    this.controls.maxPolarAngle = Math.PI * 0.95

    const interrupt = () => {
      this.focusActive = false
    }

    canvas.addEventListener("pointerdown", interrupt)
    canvas.addEventListener("wheel", interrupt, { passive: true })

    const hemisphere = new THREE.HemisphereLight(0xdde4ff, 0x40383a, 1.1)
    const key = new THREE.DirectionalLight(0xfff2e4, 2.2)
    const rim = new THREE.DirectionalLight(0x99bbff, 0.8)

    key.position.set(2, 6, 3)
    key.target.position.set(0, 0.9, 0)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -2.5
    key.shadow.camera.right = 2.5
    key.shadow.camera.top = 3
    key.shadow.camera.bottom = -3
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 20
    key.shadow.bias = -0.0001
    key.shadow.normalBias = 0.02
    rim.position.set(-2.5, 2, -2.5)

    this.scene.add(hemisphere, key, key.target, rim)

    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 48),
      new THREE.ShadowMaterial({ opacity: 0.25 }),
    )

    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.scene.add(this.ground)

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.72, 0.735, 64),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.08,
        side: THREE.DoubleSide,
      }),
    )

    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.001
    this.scene.add(this.ring)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas.parentElement ?? canvas)
    this.resize()

    const renderLoop = () => {
      if (this.disposed) {
        return
      }

      this.animationFrame = requestAnimationFrame(renderLoop)

      if (this.focusActive) {
        this.controls.target.lerp(this.focusTarget, 0.08)
        this.camera.position.lerp(this.focusPosition, 0.08)

        if (
          this.controls.target.distanceTo(this.focusTarget) < 0.005 &&
          this.camera.position.distanceTo(this.focusPosition) < 0.005
        ) {
          this.focusActive = false
        }
      }

      this.controls.update()
      this.renderer.render(this.scene, this.camera)
    }

    renderLoop()
  }

  async load(data: AvatarData) {
    if (this.disposed) {
      return
    }

    this.slSkeleton = new SLSkeleton(data.skeleton)
    this.aliasMap.clear()

    for (const def of data.skeleton) {
      this.aliasMap.set(def.name, def.name)

      for (const alias of def.aliases) {
        this.aliasMap.set(alias, def.name)
      }
    }

    const sceneRoot = new THREE.Group()
    const boneByName = new Map<string, THREE.Bone>()
    const sceneBones: THREE.Bone[] = []

    for (const def of data.skeleton) {
      const bone = new THREE.Bone()

      bone.name = def.name

      const parent = def.parent ? boneByName.get(def.parent) : undefined

      if (parent) {
        parent.add(bone)
      } else {
        sceneRoot.add(bone)
      }

      boneByName.set(def.name, bone)
      sceneBones.push(bone)
    }

    // Indra binds system meshes by pivot offsets, not inverse rest matrices
    // (LLSkinJoint::setupSkinJoint, llviewerjointmesh.cpp:100-156):
    // palette = T(-totalSkinOffset) * jointWorld. The eye bones get identity
    // inverses instead: eyeballs are rigid joint meshes with joint-local
    // coordinates, and no body mesh weight ever references the eye bones.
    const slSkeleton = this.slSkeleton
    const boneInverses = sceneBones.map((bone) => {
      if (bone.name === "mEyeLeft" || bone.name === "mEyeRight") {
        return new THREE.Matrix4()
      }

      const pivot = slVecToGltf(slSkeleton.pivotSum(bone.name))

      return new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2])
    })

    const systemSkeleton = new THREE.Skeleton(sceneBones, boneInverses)
    const eyeBoneForMesh: Record<string, string> = {
      eyeBallLeftMesh: "mEyeLeft",
      eyeBallRightMesh: "mEyeRight",
    }

    const skin = new THREE.MeshStandardMaterial({
      color: 0xb9aa9d,
      roughness: 0.55,
      metalness: 0,
    })
    const eye = new THREE.MeshStandardMaterial({
      color: 0xd8d4ce,
      roughness: 0.25,
      metalness: 0,
    })

    for (const meshName of Object.keys(data.meshes)) {
      const base = data.base[meshName]
      const faces = data.faces[meshName]

      if (!base || !faces) {
        continue
      }

      const positions = new Float32Array(base.count * 3)
      const normals = new Float32Array(base.count * 3)
      const uvs = new Float32Array(base.count * 2)

      for (let vertex = 0; vertex < base.count; vertex++) {
        const record = base.offset + vertex * 8

        for (let axis = 0; axis < 3; axis++) {
          positions[vertex * 3 + axis] = data.baseFloats[record + axis]
          normals[vertex * 3 + axis] = data.baseFloats[record + 3 + axis]
        }

        uvs[vertex * 2] = data.baseFloats[record + 6]
        uvs[vertex * 2 + 1] = data.baseFloats[record + 7]
      }

      const geometry = new THREE.BufferGeometry()

      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3))
      geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3))
      geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2))
      geometry.setIndex(
        new THREE.BufferAttribute(
          data.faceIndices.slice(faces.offset, faces.offset + faces.count),
          1,
        ),
      )
      geometry.computeBoundingSphere()

      let material: THREE.Material

      if (meshName === "eyelashMesh") {
        material = new THREE.MeshStandardMaterial({
          color: 0x2a211c,
          roughness: 0.8,
          metalness: 0,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      } else if (meshName.startsWith("eyeBall")) {
        material = eye
      } else {
        material = skin
      }

      const mesh = new THREE.SkinnedMesh(geometry, material)

      mesh.name = meshName
      mesh.castShadow = true
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      sceneRoot.add(mesh)

      mesh.bind(systemSkeleton, new THREE.Matrix4())

      if (data.skins[meshName]) {
        applyAuthenticSkin(mesh, data, meshName)
      } else if (eyeBoneForMesh[meshName]) {
        const boneIndex = sceneBones.findIndex((bone) => bone.name === eyeBoneForMesh[meshName])
        const skinIndex = new Uint16Array(base.count * 4).fill(0)
        const skinWeight = new Float32Array(base.count * 4)

        for (let vertex = 0; vertex < base.count; vertex++) {
          skinIndex[vertex * 4] = boneIndex
          skinWeight[vertex * 4] = 1
        }

        geometry.setAttribute("skinIndex", new THREE.BufferAttribute(skinIndex, 4))
        geometry.setAttribute("skinWeight", new THREE.BufferAttribute(skinWeight, 4))
      }

      this.meshes.set(meshName, {
        mesh,
        basePositions: new Float32Array(positions),
        baseNormals: new Float32Array(normals),
      })
    }

    this.root.add(sceneRoot)
    this.root.updateMatrixWorld(true)

    this.defaultScene = sceneRoot
    this.defaultBones = captureBones(sceneRoot, (name) => this.aliasMap.get(name) ?? null)
    this.bones = this.defaultBones

    // rest pose until the first applyPose lands
    this.applyBones(data, { weights: new Map(), morphWeights: new Map() })
  }

  async loadCustomRig(url: string, fileName: string): Promise<{ matched: number }> {
    const rigScene = await loadRigScene(url, fileName)

    if (this.disposed) {
      return { matched: 0 }
    }

    this.clearCustomRig()

    const bones = captureBones(rigScene, (name) => this.aliasMap.get(name) ?? null)

    if (!bones.has("mPelvis")) {
      throw new Error("No Second Life skeleton found (missing mPelvis bone)")
    }

    let hasSkinnedMesh = false

    rigScene.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) {
        hasSkinnedMesh = true
        object.castShadow = true
        object.frustumCulled = false
        object.normalizeSkinWeights()
      }
    })

    if (!hasSkinnedMesh) {
      throw new Error("No rigged mesh found in this file")
    }

    // corrections must be computed at the rig's own bind pose, with no
    // preview pose applied
    this.applyPosePresetRotations(null)
    this.applyJointOverrides(bones)
    this.applyRigPose(bones)
    this.computeRigCorrections(bones)
    this.applyPosePresetRotations(this.posePreset)

    this.customScene = rigScene
    this.root.add(rigScene)

    if (this.defaultScene) {
      this.defaultScene.visible = false
    }

    this.bones = bones

    let matched = 0

    for (const rest of bones.values()) {
      if (rest.slName) {
        matched++
      }
    }

    return { matched }
  }

  // Mesh assets override joint rest positions when they differ from the
  // skeleton defaults by more than 0.1mm (lljoint.cpp:395-400 via the asset
  // loaders); an active override pins the joint against shape position deltas.
  // GLB exports bake Blender bone orientations and the authored pose (A-pose
  // rigs) into joint rotations, so the offset's direction cannot distinguish
  // pose from a real override — only its length is pose-invariant. A length
  // change is treated as an override along the SL default direction.
  private applyJointOverrides(bones: Map<string, BoneRest>) {
    const skeleton = this.slSkeleton

    if (!skeleton) {
      return
    }

    const childScratch = new THREE.Vector3()
    const ancestorScratch = new THREE.Vector3()

    for (const rest of bones.values()) {
      const joint = rest.slName ? skeleton.joint(rest.slName) : undefined

      // pelvis position is handled as a render fixup in the viewer, not a
      // joint override (llvoavatar.cpp mPelvisFixup)
      if (!joint || rest.slName === "mPelvis" || rest.slName === "mRoot") {
        continue
      }

      let ancestor = rest.bone.parent

      while (ancestor && !(ancestor instanceof THREE.Bone && this.aliasMap.has(ancestor.name))) {
        ancestor = ancestor.parent
      }

      if (!ancestor) {
        continue
      }

      childScratch.setFromMatrixPosition(rest.restMatrix)
      ancestorScratch.setFromMatrixPosition(ancestor.matrixWorld)
      childScratch.sub(ancestorScratch)

      const offsetLength = childScratch.length()
      const defaultLength = Math.hypot(
        joint.defaultPos[0],
        joint.defaultPos[1],
        joint.defaultPos[2],
      )

      if (Math.abs(offsetLength - defaultLength) <= 1e-4) {
        continue
      }

      if (defaultLength > 1e-6) {
        const ratio = offsetLength / defaultLength

        joint.posOverride = [
          joint.defaultPos[0] * ratio,
          joint.defaultPos[1] * ratio,
          joint.defaultPos[2] * ratio,
        ]
      } else {
        joint.posOverride = gltfVecToSl([childScratch.x, childScratch.y, childScratch.z])
      }
    }
  }

  // Rigs are often exported away from the SL rest pose (A-pose bodies). SL
  // treats such a pose as animation: joint rotations that shape deformations
  // then flow through (xform.cpp rotates child offsets by the parent's world
  // rotation). Estimate each joint's pose as the rotation mapping its SL bind
  // child offsets onto the rig's bind child offsets — longest child first via
  // shortest arc, a second non-collinear child fixes the twist, single-child
  // chains inherit the parent twist. Residual error is absorbed by the bind
  // corrections below.
  private applyRigPose(bones: Map<string, BoneRest>) {
    const skeleton = this.slSkeleton

    if (!skeleton) {
      return
    }

    const identity: Quat = [0, 0, 0, 1]
    const worldPose = new Map<string, Quat>()

    for (const joint of skeleton.ordered) {
      const parentPose = joint.parent ? (worldPose.get(joint.parent.name) ?? identity) : identity
      const rest = bones.get(joint.name)

      const pairs: { slOffset: Vec3; rigOffset: Vec3; length: number }[] = []

      if (rest) {
        for (const child of joint.children) {
          const childRest = bones.get(child.name)

          if (!childRest) {
            continue
          }

          const slOffset = child.posOverride ?? child.defaultPos
          const rigOffset = gltfVecToSl([
            childRest.worldPosition.x - rest.worldPosition.x,
            childRest.worldPosition.y - rest.worldPosition.y,
            childRest.worldPosition.z - rest.worldPosition.z,
          ])
          const length = Math.hypot(slOffset[0], slOffset[1], slOffset[2])

          if (length > 2e-3 && Math.hypot(rigOffset[0], rigOffset[1], rigOffset[2]) > 2e-3) {
            pairs.push({ slOffset, rigOffset, length })
          }
        }
      }

      if (pairs.length === 0) {
        worldPose.set(joint.name, parentPose)
        continue
      }

      pairs.sort((left, right) => right.length - left.length)

      const primary = pairs[0]

      let pose = mulQuat(
        shortestArcQuat(rotateVec(parentPose, primary.slOffset), primary.rigOffset),
        parentPose,
      )

      const axisLength = Math.hypot(
        primary.rigOffset[0],
        primary.rigOffset[1],
        primary.rigOffset[2],
      )
      const axis: Vec3 = [
        primary.rigOffset[0] / axisLength,
        primary.rigOffset[1] / axisLength,
        primary.rigOffset[2] / axisLength,
      ]

      for (const second of pairs.slice(1)) {
        const posed = rotateVec(pose, second.slOffset)
        const planar = (vec: Vec3): Vec3 => {
          const along = vec[0] * axis[0] + vec[1] * axis[1] + vec[2] * axis[2]

          return [vec[0] - along * axis[0], vec[1] - along * axis[1], vec[2] - along * axis[2]]
        }
        const fromPlanar = planar(posed)
        const toPlanar = planar(second.rigOffset)

        if (Math.hypot(...fromPlanar) < 5e-3 || Math.hypot(...toPlanar) < 5e-3) {
          continue
        }

        const cross: Vec3 = [
          fromPlanar[1] * toPlanar[2] - fromPlanar[2] * toPlanar[1],
          fromPlanar[2] * toPlanar[0] - fromPlanar[0] * toPlanar[2],
          fromPlanar[0] * toPlanar[1] - fromPlanar[1] * toPlanar[0],
        ]
        const sin = cross[0] * axis[0] + cross[1] * axis[1] + cross[2] * axis[2]
        const cos =
          fromPlanar[0] * toPlanar[0] + fromPlanar[1] * toPlanar[1] + fromPlanar[2] * toPlanar[2]

        pose = mulQuat(quatFromAxisAngle(axis, Math.atan2(sin, cos)), pose)
        break
      }

      worldPose.set(joint.name, pose)
    }

    for (const joint of skeleton.ordered) {
      if (joint.isVolume) {
        continue
      }

      const pose = worldPose.get(joint.name)

      if (!pose) {
        continue
      }

      const parentPose = joint.parent ? (worldPose.get(joint.parent.name) ?? identity) : identity
      const localPose = mulQuat(invQuat(parentPose), pose)

      if (1 - Math.abs(localPose[3]) > 1e-7) {
        joint.poseRot = localPose
      }
    }
  }

  // Rigs exported with non-SL rest orientations (Blender bones aim along the
  // bone axis; SL bone rests are unrotated) bake those orientations into their
  // inverse bind matrices. A constant per-joint correction maps our SL joint
  // matrices onto the rig's authored rest: final = W_current * W_bind^-1 *
  // W_assetRest. Identity for rigs authored on the plain SL skeleton, in which
  // case this reduces to indra's palette = jointWorld * invBind.
  private computeRigCorrections(bones: Map<string, BoneRest>) {
    const skeleton = this.slSkeleton
    const assetPelvis = bones.get("mPelvis")
    const pelvisJoint = skeleton?.joint("mPelvis")

    if (!skeleton || !assetPelvis || !pelvisJoint) {
      return
    }

    skeleton.resetToDefaults()
    skeleton.updateWorld()

    // the asset frame may differ from ours by the pelvis origin (we zero
    // mPelvis under mRoot per SL-315; exports keep the file's 1.067 offset)
    const ourPelvisPos = slVecToGltf(pelvisJoint.worldPos)
    const assetPelvisPos = new THREE.Vector3().setFromMatrixPosition(assetPelvis.restMatrix)
    const shift = new THREE.Matrix4().makeTranslation(
      ourPelvisPos[0] - assetPelvisPos.x,
      ourPelvisPos[1] - assetPelvisPos.y,
      ourPelvisPos[2] - assetPelvisPos.z,
    )

    for (const rest of bones.values()) {
      const joint = rest.slName ? skeleton.joint(rest.slName) : undefined

      if (!joint) {
        continue
      }

      jointWorldMatrixGltf(joint, this.matrixScratch)

      rest.correction = new THREE.Matrix4()
        .fromArray(this.matrixScratch)
        .invert()
        .multiply(shift)
        .multiply(rest.restMatrix)
    }
  }

  // Preview pose in SL space (mayaQ XYZ degrees per joint), applied like an
  // animation: it replaces the joint's pose rotation, so it also straightens
  // or re-poses custom rigs
  setPosePreset(rotations: PoseRotations | null) {
    this.posePreset = rotations
    this.applyPosePresetRotations(rotations)
  }

  private applyPosePresetRotations(rotations: PoseRotations | null) {
    const skeleton = this.slSkeleton

    if (!skeleton) {
      return
    }

    for (const joint of skeleton.ordered) {
      joint.presetRot = null
    }

    if (!rotations) {
      return
    }

    for (const [name, degrees] of Object.entries(rotations)) {
      const joint = skeleton.joint(name)

      if (joint) {
        joint.presetRot = mayaQuatXYZ(degrees[0], degrees[1], degrees[2])
      }
    }
  }

  clearCustomRig() {
    if (this.customScene) {
      this.root.remove(this.customScene)

      this.customScene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose()
        }
      })

      this.customScene = null
    }

    if (this.slSkeleton) {
      for (const joint of this.slSkeleton.ordered) {
        joint.posOverride = null
        joint.poseRot = null
      }
    }

    if (this.defaultScene) {
      this.defaultScene.visible = true
    }

    this.bones = this.defaultBones
  }

  get hasCustomRig(): boolean {
    return this.customScene !== null
  }

  resetCamera() {
    this.focusTarget.copy(HOME_TARGET)
    this.focusPosition.copy(HOME_POSITION)
    this.focusActive = true
  }

  applyPose(data: AvatarData, pose: AvatarPose) {
    if (this.customScene) {
      this.applyBones(data, pose)
      return
    }

    this.applyMorphs(data, pose)
    this.applyBones(data, pose)
  }

  private applyMorphs(data: AvatarData, pose: AvatarPose) {
    for (const [meshName, morphable] of this.meshes) {
      const geometry = morphable.mesh.geometry as THREE.BufferGeometry
      const positions = geometry.getAttribute("position") as THREE.BufferAttribute
      const normals = geometry.getAttribute("normal") as THREE.BufferAttribute
      const positionArray = positions.array as Float32Array
      const normalArray = normals.array as Float32Array

      positionArray.set(morphable.basePositions)
      normalArray.set(morphable.baseNormals)

      const prefix = `${meshName}:`

      for (const [key, weight] of pose.morphWeights) {
        if (!key.startsWith(prefix) || Math.abs(weight) < 1e-5) {
          continue
        }

        const entry = data.morphManifest[key]

        if (!entry) {
          continue
        }

        const normalWeight = weight * NORMAL_SOFTEN_FACTOR

        for (let record = 0; record < entry.count; record++) {
          const base = entry.offset + record * 7
          const vertex = data.morphIndices[base]

          positionArray[vertex * 3] += weight * data.morphFloats[base + 1]
          positionArray[vertex * 3 + 1] += weight * data.morphFloats[base + 2]
          positionArray[vertex * 3 + 2] += weight * data.morphFloats[base + 3]
          normalArray[vertex * 3] += normalWeight * data.morphFloats[base + 4]
          normalArray[vertex * 3 + 1] += normalWeight * data.morphFloats[base + 5]
          normalArray[vertex * 3 + 2] += normalWeight * data.morphFloats[base + 6]
        }
      }

      for (let vertex = 0; vertex < normalArray.length / 3; vertex++) {
        const nx = normalArray[vertex * 3]
        const ny = normalArray[vertex * 3 + 1]
        const nz = normalArray[vertex * 3 + 2]
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz)

        if (length > 1e-6) {
          normalArray[vertex * 3] = nx / length
          normalArray[vertex * 3 + 1] = ny / length
          normalArray[vertex * 3 + 2] = nz / length
        }
      }

      positions.needsUpdate = true
      normals.needsUpdate = true
      geometry.computeBoundingSphere()
    }
  }

  private applyBones(data: AvatarData, pose: AvatarPose) {
    const skeleton = this.slSkeleton

    if (!skeleton) {
      return
    }

    skeleton.applyParams(pose.weights, data.params)

    // The viewer places mRoot at ground + pelvisToFoot + hover
    // (llvoavatar updateRootPositionAndRotation / computeBodySize)
    const { pelvisToFoot } = skeleton.computeBodySize()
    const hover = pose.weights.get(HOVER_PARAM_ID) ?? 0
    const lift = pelvisToFoot + hover

    for (const rest of this.bones.values()) {
      const joint = rest.slName ? skeleton.joint(rest.slName) : undefined

      if (joint) {
        jointWorldMatrixGltf(joint, this.matrixScratch)
        rest.bone.matrixWorld.fromArray(this.matrixScratch)
        rest.bone.matrixWorld.elements[13] += lift

        if (rest.correction) {
          rest.bone.matrixWorld.multiply(rest.correction)
        }
      } else {
        rest.bone.matrixWorld.copy(rest.restMatrix)
      }
    }

    this.updateGround(hover)
  }

  // The avatar sinks slightly below z=0 at default (the viewer's pelvisToFoot
  // quirk), so the ground plane follows the lowest skinned point instead of
  // slicing the feet. Hover is excluded so it still visibly floats or sinks
  // the avatar relative to the ground.
  private updateGround(hover: number) {
    let minY = Infinity

    const sample = (mesh: THREE.SkinnedMesh) => {
      const position = mesh.geometry.getAttribute("position") as THREE.BufferAttribute
      const stride = Math.max(1, Math.floor(position.count / 1500))

      for (let vertex = 0; vertex < position.count; vertex += stride) {
        mesh.getVertexPosition(vertex, this.vertexScratch)

        if (this.vertexScratch.y < minY) {
          minY = this.vertexScratch.y
        }
      }
    }

    if (this.customScene) {
      this.customScene.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) {
          sample(object)
        }
      })
    } else {
      const lower = this.meshes.get("lowerBodyMesh")

      if (lower) {
        sample(lower.mesh)
      }
    }

    if (Number.isFinite(minY)) {
      this.ground.position.y = minY - hover
      this.ring.position.y = minY - hover + 0.001
    }
  }

  focusGroup(group: ShapeGroupKey) {
    const preset = FOCUS_PRESETS[group]

    if (!preset) {
      return
    }

    const headBone = this.bones.get("mHead")?.bone
    const target = new THREE.Vector3(...preset.target)

    if (group !== "shape_body" && group !== "shape_torso" && group !== "shape_legs" && headBone) {
      const headWorld = new THREE.Vector3()

      headBone.getWorldPosition(headWorld)
      target.y += headWorld.y + 0.05 - 1.72
    }

    const direction = this.camera.position.clone().sub(this.controls.target)

    if (direction.lengthSq() < 1e-6) {
      direction.set(0.6, 0.2, 1)
    }

    direction.normalize().multiplyScalar(preset.distance)

    this.focusTarget.copy(target)
    this.focusPosition.copy(target).add(direction)
    this.focusActive = true
  }

  private resize() {
    const parent = this.canvas.parentElement

    if (!parent) {
      return
    }

    const width = parent.clientWidth
    const height = parent.clientHeight

    if (width === 0 || height === 0) {
      return
    }

    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.animationFrame)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
  }
}
