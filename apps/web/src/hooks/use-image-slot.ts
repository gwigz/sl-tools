import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import { deleteBlob, loadBlob, saveBlob } from "~/lib/blob-store"
import { loadImageBitmap } from "~/lib/sl/image"

/** A persisted image upload (overlay, mask, …) backed by an IndexedDB key. */
export function useImageSlot(key: string, errorLabel: string) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const stored = await loadBlob(key)

        if (cancelled || !stored) {
          return
        }

        const file = new File([stored.blob], stored.name, { type: stored.blob.type })
        const loaded = await loadImageBitmap(file)

        if (cancelled) {
          loaded.close()
          return
        }

        setBitmap(loaded)
        setName(stored.name)
      } catch {}
    })()

    return () => {
      cancelled = true
    }
  }, [key])

  const handleSelect = useCallback(
    async (file: File) => {
      try {
        const loaded = await loadImageBitmap(file)

        setBitmap((prev) => {
          prev?.close()
          return loaded
        })
        setName(file.name)

        saveBlob(key, { blob: file, name: file.name }).catch(() => {})
      } catch {
        toast.error(errorLabel)
      }
    },
    [key, errorLabel],
  )

  const reset = useCallback(() => {
    setBitmap((prev) => {
      prev?.close()
      return null
    })
    setName(null)

    deleteBlob(key).catch(() => {})
  }, [key])

  return { bitmap, name, handleSelect, reset }
}
