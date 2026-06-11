"use client"

import { Star, Upload, X } from "lucide-react"
import { useCallback, useRef, useState } from "react"
import { toast } from "sonner"
import { useSnapshot } from "valtio"

import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { type AvatarData, parseShapeXml } from "~/lib/sl/shape"
import { cn } from "~/lib/utils"

import {
  captureState,
  type ImportedShape,
  removeShape,
  resetToDefault,
  restoreCaptured,
  setAsBase,
  state,
} from "./store"

function destructiveAction(message: string, action: () => void) {
  const saved = captureState()

  action()
  toast(message, {
    duration: 10000,
    action: {
      label: "Undo",
      onClick: () => restoreCaptured(saved),
    },
  })
}

export function ShapesCard({ data }: { data: AvatarData | null }) {
  const snap = useSnapshot(state)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const importFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (!data || !files || files.length === 0) {
        return
      }

      for (const file of files) {
        try {
          const text = await file.text()
          const parsed = parseShapeXml(text, data)
          const shape: ImportedShape = {
            id: crypto.randomUUID(),
            name: parsed.name ?? file.name.replace(/\.xml$/i, ""),
            values: parsed.values,
          }

          const isFirst = state.shapes.length === 0

          state.shapes.push(shape)

          if (isFirst) {
            setAsBase(shape)
            toast.success(`Imported "${shape.name}" and set it as the base shape`)
          } else {
            toast.success(`Imported "${shape.name}"`)
          }
        } catch (error) {
          toast.error(`${file.name}: ${error instanceof Error ? error.message : "import failed"}`)
        }
      }
    },
    [data],
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Shapes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            importFiles(event.dataTransfer.files)
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed p-4 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground",
            dragging && "border-primary text-foreground",
          )}
          disabled={!data}
        >
          <Upload className="size-4" />
          <span>Drop Appearance XML Files Here</span>
          <span className="text-[10px] text-muted-foreground/70">
            Avatar &gt; Character Tests &gt; Appearance To XML
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xml,text/xml"
          multiple
          hidden
          onChange={(event) => {
            importFiles(event.target.files)
            event.target.value = ""
          }}
        />

        <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5 text-xs">
          <span className="flex items-center gap-1.5">
            <Star className="size-3 fill-current text-amber-400" />
            <span className="max-w-40 truncate font-medium">{snap.baseName}</span>
            <Badge variant="secondary" className="text-[10px]">
              Base
            </Badge>
          </span>
          {data && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={() => {
                destructiveAction("Reset to the default shape", () => resetToDefault(data))
              }}
            >
              Reset To Default
            </Button>
          )}
        </div>

        {snap.shapes.length > 0 && (
          <ul className="flex flex-col gap-1">
            {snap.shapes.map((shape) => (
              <li
                key={shape.id}
                className="flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-xs"
              >
                <span className="truncate">{shape.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => {
                      const hadTweaks =
                        Object.keys(state.overrides).length > 0 ||
                        Object.values(state.blends).some(Boolean)

                      destructiveAction(
                        hadTweaks
                          ? `Set "${shape.name}" as base, previous tweaks discarded`
                          : `Set "${shape.name}" as base`,
                        () => setAsBase({ ...shape, values: { ...shape.values } }),
                      )
                    }}
                  >
                    Set As Base
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={`Remove ${shape.name}`}
                    onClick={() => {
                      destructiveAction(`Removed "${shape.name}"`, () => removeShape(shape.id))
                    }}
                  >
                    <X className="size-3" />
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
