import { SiGithub } from "react-icons/si"

import { TextureTool } from "~/components/texture-tool/texture-tool"

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-6">
      <TextureTool />
      <footer className="mt-6 flex justify-center text-sm text-muted-foreground">
        <a
          href="https://github.com/gwigz/sl-tools"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
        >
          <SiGithub className="size-4" /> GitHub
        </a>
      </footer>
    </main>
  )
}
