import { SiteFooter } from "~/components/site-footer"
import { SiteHeader } from "~/components/site-header"
import { TextureTool } from "~/components/texture-tool/texture-tool"

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-6">
      <SiteHeader />
      <TextureTool />
      <SiteFooter />
    </main>
  )
}
