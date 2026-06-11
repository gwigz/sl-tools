"use client"

import type { Route } from "next"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs"

const TOOLS: { href: Route; label: string }[] = [
  { href: "/", label: "Texture Anim" },
  { href: "/shape" as Route, label: "Shape Blender" },
  { href: "/sound" as Route, label: "Sound Splitter" },
]

export function SiteHeader() {
  const pathname = usePathname()

  return (
    <header className="mb-4 flex items-center justify-center">
      <Tabs value={pathname}>
        <TabsList>
          {TOOLS.map((tool) => (
            <TabsTrigger
              key={tool.href}
              value={tool.href}
              render={<Link href={tool.href} />}
              nativeButton={false}
              className="px-3"
            >
              {tool.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </header>
  )
}
