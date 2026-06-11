import type { Metadata } from "next"

import { Badge } from "~/components/ui/badge"
import { SiteFooter } from "~/components/site-footer"
import { SiteHeader } from "~/components/site-header"
import { SoundTool } from "~/components/sound-tool/sound-tool"

export const metadata: Metadata = {
  title: "Sound Splitter",
  description:
    "Split a long audio track into Second Life ready sound clips (44.1kHz 16-bit mono WAV, under 30 seconds) with a gapless LSL player script.",
}

export default function SoundPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-6">
      <SiteHeader />
      <div className="mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Sound Splitter</h1>
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
      <SoundTool />
      <SiteFooter />
    </main>
  )
}
