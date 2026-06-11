import { SiGithub } from "react-icons/si"

export function SiteFooter() {
  return (
    <footer className="mt-auto flex items-center justify-center pt-8 pb-2">
      <a
        href="https://github.com/gwigz/sl-tools"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <SiGithub className="size-3.5" />
        <span>gwigz/sl-tools</span>
      </a>
    </footer>
  )
}
