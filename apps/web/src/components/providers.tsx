"use client"

import { Toaster } from "@gwigz/sl-tools-ui/components/sonner"

import { ThemeProvider } from "./theme-provider"

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" forcedTheme="dark" disableTransitionOnChange>
      {children}
      <Toaster />
    </ThemeProvider>
  )
}
