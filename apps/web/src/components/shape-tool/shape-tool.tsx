"use client"

import { useEffect, useMemo, useState } from "react"
import { useSnapshot } from "valtio"

import { Card, CardContent } from "~/components/ui/card"
import { Badge } from "~/components/ui/badge"

import { type AvatarData, computePose, defaultShapeValues, loadAvatarData } from "~/lib/sl/shape"

import { ExportCard } from "./export-card"
import { ShapesCard } from "./shapes-card"
import { SlidersCard } from "./sliders-card"
import {
  effectiveValues,
  type PersistedShapeState,
  restoreState,
  snapshotForPersistence,
  state,
  ui,
} from "./store"
import { ViewportCard } from "./viewport-card"

const STORAGE_KEY = "sl-shape:state:v1"

export function ShapeTool() {
  const [data, setData] = useState<AvatarData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const snap = useSnapshot(state)
  const uiSnap = useSnapshot(ui)

  useEffect(() => {
    let cancelled = false

    loadAvatarData()
      .then((loaded) => {
        if (cancelled) {
          return
        }

        try {
          const raw = localStorage.getItem(STORAGE_KEY)

          if (raw) {
            restoreState(JSON.parse(raw) as Partial<PersistedShapeState>, loaded)
          } else {
            state.baseValues = defaultShapeValues(loaded)
          }
        } catch {
          state.baseValues = defaultShapeValues(loaded)
        }

        ui.hydrated = true
        setData(loaded)
      })
      .catch(() => {
        if (!cancelled) {
          setError("Failed to load avatar data")
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!uiSnap.hydrated) {
      return
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshotForPersistence(snap)))
    } catch {}
  }, [snap, uiSnap.hydrated])

  const values = useMemo(() => {
    if (!data) {
      return null
    }

    return effectiveValues(snap, data)
  }, [snap, data])

  const pose = useMemo(() => {
    if (!data || !values) {
      return null
    }

    return computePose(values, data)
  }, [values, data])

  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {error}
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
      <div className="lg:col-span-2">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Shape Blender</h1>
          <Badge
            variant="outline"
            className="border-amber-400/30 bg-amber-400/10 text-amber-300"
            title="Expect bugs"
          >
            Experimental
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs entirely in your browser, nothing is uploaded
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <ViewportCard data={data} pose={pose} focusGroup={uiSnap.activeGroup} />
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <ShapesCard data={data} />
          <ExportCard data={data} values={values} />
        </div>
      </div>
      <SlidersCard data={data} values={values} />
    </div>
  )
}
