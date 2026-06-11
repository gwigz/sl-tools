import type { Metadata } from "next"

import { ShapeTool } from "~/components/shape-tool/shape-tool"
import { SiteFooter } from "~/components/site-footer"
import { SiteHeader } from "~/components/site-header"

export const metadata: Metadata = {
  title: "Shape Blender",
  description:
    "Import Second Life shapes, blend parts of them together, tweak every slider with a live 3D preview, and export back to XML.",
}

export default function ShapePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-4 py-6">
      <SiteHeader />
      <ShapeTool />
      <SiteFooter />
    </main>
  )
}
