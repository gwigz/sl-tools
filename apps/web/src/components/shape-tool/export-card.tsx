"use client"

import { Download } from "lucide-react"
import { useState } from "react"
import { useSnapshot } from "valtio"

import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { Input } from "~/components/ui/input"
import { type AvatarData, serializeShapeXml, type ShapeValues } from "~/lib/sl/shape"

import { state } from "./store"

export function ExportCard({
  data,
  values,
}: {
  data: AvatarData | null
  values: ShapeValues | null
}) {
  const snap = useSnapshot(state)
  const [name, setName] = useState("")

  if (!data || !values) {
    return null
  }

  const exportName = name.trim() || `${snap.baseName} (Blended)`

  const buildXml = () => serializeShapeXml(values, data, exportName)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <Input
          value={name}
          placeholder={exportName}
          onChange={(event) => setName(event.target.value)}
        />
        <Button
          onClick={() => {
            const blob = new Blob([buildXml()], { type: "application/xml" })
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement("a")

            anchor.href = url
            anchor.download = `${exportName.replace(/[^\w\s.-]/g, "")}.xml`
            anchor.click()
            URL.revokeObjectURL(url)
          }}
        >
          <Download className="size-4" /> Download XML
        </Button>
        <p className="text-[10px] text-muted-foreground">
          Import in Firestorm with the shape editor&apos;s Import button while editing a modifiable
          shape.
        </p>
      </CardContent>
    </Card>
  )
}
