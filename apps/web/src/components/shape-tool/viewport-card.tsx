"use client"

import { Settings2, Upload, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useSnapshot } from "valtio"

import { Button } from "~/components/ui/button"
import { Card } from "~/components/ui/card"
import { Label } from "~/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Spinner } from "~/components/ui/spinner"
import { Switch } from "~/components/ui/switch"
import { deleteBlob, loadBlob, saveBlob } from "~/lib/blob-store"
import { AvatarScene, type PoseRotations } from "~/lib/sl/avatar-scene"
import type { AvatarData, AvatarPose, ShapeGroupKey } from "~/lib/sl/shape"

import { ui } from "./store"

const RIG_STORAGE_KEY = "sl-shape:rig:v1"

// SL space, mayaQ XYZ degrees per joint. Applied like an animation: replaces
// the joint's rest or authored pose, so T-Pose also straightens A-posed rigs.
const POSES: { value: string; label: string; rotations: PoseRotations | null }[] = [
  { value: "default", label: "Default", rotations: null },
  {
    value: "t-pose",
    label: "T-Pose",
    rotations: {
      mCollarLeft: [0, 0, 0],
      mCollarRight: [0, 0, 0],
      mShoulderLeft: [0, 0, 0],
      mShoulderRight: [0, 0, 0],
      mElbowLeft: [0, 0, 0],
      mElbowRight: [0, 0, 0],
      mWristLeft: [0, 0, 0],
      mWristRight: [0, 0, 0],
      mHipLeft: [0, 0, 0],
      mHipRight: [0, 0, 0],
      mKneeLeft: [0, 0, 0],
      mKneeRight: [0, 0, 0],
      mAnkleLeft: [0, 0, 0],
      mAnkleRight: [0, 0, 0],
    },
  },
  {
    value: "a-pose",
    label: "A-Pose",
    rotations: {
      mShoulderLeft: [-40, 0, 0],
      mShoulderRight: [40, 0, 0],
      mElbowLeft: [-8, 0, 0],
      mElbowRight: [8, 0, 0],
      mHipLeft: [8, 0, 0],
      mHipRight: [-8, 0, 0],
    },
  },
  {
    value: "relaxed",
    label: "Relaxed",
    rotations: {
      mCollarLeft: [-5, 0, 0],
      mCollarRight: [5, 0, 0],
      mShoulderLeft: [-62, 0, -4],
      mShoulderRight: [62, 0, 4],
      mElbowLeft: [-12, 0, -4],
      mElbowRight: [12, 0, 4],
      mWristLeft: [-5, 0, 0],
      mWristRight: [5, 0, 0],
      mHipLeft: [4, 0, 8],
      mHipRight: [-4, 0, -8],
    },
  },
]

function poseRotations(value: string): PoseRotations | null {
  return POSES.find((pose) => pose.value === value)?.rotations ?? null
}

export function ViewportCard({
  data,
  pose,
  focusGroup,
}: {
  data: AvatarData | null
  pose: AvatarPose | null
  focusGroup: ShapeGroupKey | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const sceneRef = useRef<AvatarScene | null>(null)
  const poseRef = useRef<AvatarPose | null>(null)
  const [loaded, setLoaded] = useState(false)

  const uiSnap = useSnapshot(ui)

  useEffect(() => {
    poseRef.current = pose
  }, [pose])

  useEffect(() => {
    if (!data || !canvasRef.current) {
      return
    }

    const scene = new AvatarScene(canvasRef.current)

    sceneRef.current = scene

    let cancelled = false

    scene
      .load(data)
      .then(async () => {
        if (cancelled) {
          return
        }

        scene.setPosePreset(poseRotations(ui.posePreset))

        if (poseRef.current) {
          scene.applyPose(data, poseRef.current)
        }

        setLoaded(true)

        const stored = await loadBlob(RIG_STORAGE_KEY).catch(() => null)

        if (cancelled || !stored) {
          return
        }

        const url = URL.createObjectURL(stored.blob)

        try {
          await scene.loadCustomRig(url, stored.name)

          if (cancelled) {
            return
          }

          ui.customRigName = stored.name

          if (poseRef.current) {
            scene.applyPose(data, poseRef.current)
          }
        } catch {
          deleteBlob(RIG_STORAGE_KEY).catch(() => {})
        } finally {
          URL.revokeObjectURL(url)
        }
      })
      .catch((error: unknown) => {
        console.error("avatar load failed", error)
      })

    return () => {
      cancelled = true
      setLoaded(false)
      sceneRef.current = null
      ui.customRigName = null
      scene.dispose()
    }
  }, [data])

  useEffect(() => {
    if (loaded && data && pose && sceneRef.current) {
      sceneRef.current.applyPose(data, pose)
    }
  }, [loaded, data, pose])

  useEffect(() => {
    if (loaded && focusGroup && uiSnap.autoCamera && sceneRef.current) {
      sceneRef.current.focusGroup(focusGroup)
    }
  }, [loaded, focusGroup, uiSnap.autoCamera])

  const uploadRig = async (file: File) => {
    const scene = sceneRef.current

    if (!scene || !data) {
      return
    }

    const url = URL.createObjectURL(file)

    try {
      const { matched } = await scene.loadCustomRig(url, file.name)

      ui.customRigName = file.name

      saveBlob(RIG_STORAGE_KEY, { blob: file, name: file.name }).catch(() => {})

      if (poseRef.current) {
        scene.applyPose(data, poseRef.current)
      }

      toast.success(`Loaded "${file.name}" (${matched} bones)`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load mesh")
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  const clearRig = () => {
    const scene = sceneRef.current

    if (!scene || !data) {
      return
    }

    scene.clearCustomRig()
    ui.customRigName = null

    deleteBlob(RIG_STORAGE_KEY).catch(() => {})

    if (poseRef.current) {
      scene.applyPose(data, poseRef.current)
    }
  }

  return (
    <Card className="relative h-[420px] overflow-hidden p-0 lg:h-[620px]">
      <canvas ref={canvasRef} className="block h-full w-full touch-none" />
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" /> Loading Avatar
        </div>
      )}
      {loaded && (
        <div className="absolute top-2 right-2">
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label="Preview Settings"
                />
              }
            >
              <Settings2 className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-60 flex-col gap-3 p-3">
              <Button variant="secondary" size="sm" onClick={() => sceneRef.current?.resetCamera()}>
                Reset Camera
              </Button>
              <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
                <Label className="text-xs">Auto Camera Focus</Label>
                <Switch
                  checked={uiSnap.autoCamera}
                  onCheckedChange={(checked) => {
                    ui.autoCamera = checked
                  }}
                />
              </label>
              <div className="h-px bg-foreground/10" />
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Pose</Label>
                <Select
                  items={POSES}
                  value={uiSnap.posePreset}
                  onValueChange={(value) => {
                    const next = (value as string | null) ?? "default"

                    ui.posePreset = next
                    sceneRef.current?.setPosePreset(poseRotations(next))

                    if (data && poseRef.current) {
                      sceneRef.current?.applyPose(data, poseRef.current)
                    }
                  }}
                >
                  <SelectTrigger size="sm" className="w-full text-xs">
                    <SelectValue placeholder="Default" />
                  </SelectTrigger>
                  <SelectContent>
                    {POSES.map((pose) => (
                      <SelectItem key={pose.value} value={pose.value}>
                        {pose.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                  Preview only, does not affect the exported shape.
                </p>
              </div>
              <div className="h-px bg-foreground/10" />
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Preview Mesh</Label>
                {uiSnap.customRigName ? (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-xs">
                    <span className="truncate">{uiSnap.customRigName}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-5 shrink-0"
                      title="Use Default Avatar"
                      onClick={clearRig}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload className="size-3.5" /> Upload Rigged Mesh
                  </Button>
                )}
                <p className="text-[10px] text-muted-foreground">
                  GLB or Collada (.dae) rigged to the SL skeleton, including fitted mesh and Bento
                  face bones. System-mesh morph detail only affects the default avatar.
                </p>
              </div>
            </PopoverContent>
          </Popover>
          <input
            ref={fileRef}
            type="file"
            accept=".glb,.gltf,.dae,model/gltf-binary,model/vnd.collada+xml"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]

              if (file) {
                uploadRig(file)
              }

              event.target.value = ""
            }}
          />
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/60">
        Drag to Orbit &middot; Scroll to Zoom &middot; Right-Drag to Pan
      </div>
    </Card>
  )
}
