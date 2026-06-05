import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { bitmapToPngDataUrl, fileToDataUrl, isTga, loadImageBitmap } from "~/lib/sl/image"

const OVERLAY_KEY = "sl-texanim:overlay:v1"

export function useOverlay(hydrated: boolean) {
  const [overlayBitmap, setOverlayBitmap] = useState<ImageBitmap | null>(null)
  const [overlayName, setOverlayName] = useState<string | null>(null)
  const [overlayDataUrl, setOverlayDataUrl] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const raw = localStorage.getItem(OVERLAY_KEY)

        if (!raw) {
          return
        }

        const { dataUrl, name } = JSON.parse(raw) as { dataUrl?: string; name?: string }

        if (!dataUrl) {
          return
        }

        const blob = await (await fetch(dataUrl)).blob()
        const file = new File([blob], "overlay", { type: blob.type })
        const bitmap = await loadImageBitmap(file)

        setOverlayBitmap(bitmap)
        setOverlayName(name ?? null)
        setOverlayDataUrl(dataUrl)
      } catch {}
    })()
  }, [])

  useEffect(() => {
    if (!hydrated) {
      return
    }

    try {
      if (overlayDataUrl && overlayName) {
        localStorage.setItem(
          OVERLAY_KEY,
          JSON.stringify({ dataUrl: overlayDataUrl, name: overlayName }),
        )
      } else {
        localStorage.removeItem(OVERLAY_KEY)
      }
    } catch {}
  }, [hydrated, overlayDataUrl, overlayName])

  const handleOverlay = useCallback(async (file: File) => {
    try {
      const bitmap = await loadImageBitmap(file)
      const dataUrl = isTga(file) ? bitmapToPngDataUrl(bitmap) : await fileToDataUrl(file)

      setOverlayBitmap((prev) => {
        prev?.close()
        return bitmap
      })
      setOverlayName(file.name)
      setOverlayDataUrl(dataUrl)
    } catch {
      toast.error("Could not load overlay image")
    }
  }, [])

  const resetOverlay = useCallback(() => {
    setOverlayBitmap((prev) => {
      prev?.close()
      return null
    })
    setOverlayName(null)
    setOverlayDataUrl(null)
  }, [])

  return { overlayBitmap, overlayName, overlayDataUrl, handleOverlay, resetOverlay }
}
