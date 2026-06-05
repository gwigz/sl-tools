import { useCallback, useEffect, useRef } from "react"
import { useSnapshot } from "valtio"

import { type Settings, settings, ui } from "~/components/texture-tool/store"
import { useDebounced } from "./use-debounced"

type Snap = Settings & { committedTrim: [number, number] }

export function useUndoRedo(hydrated: boolean) {
  const snap = useSnapshot(settings)
  const snapKey = JSON.stringify(snap)
  const snapRef = useRef(snapKey)
  snapRef.current = snapKey

  const applySnapshot = useCallback((next: Snap) => {
    Object.assign(settings, next)
    ui.trim = [next.committedTrim[0], next.committedTrim[1]]
  }, [])

  const historyRef = useRef({
    past: [] as string[],
    future: [] as string[],
    last: snapKey,
    suppress: false,
  })
  const debouncedSnapKey = useDebounced(snapKey, 350)

  useEffect(() => {
    const history = historyRef.current

    if (!hydrated) {
      history.last = debouncedSnapKey
      return
    }

    if (history.suppress) {
      history.suppress = false
      history.last = debouncedSnapKey
      return
    }

    if (debouncedSnapKey !== history.last) {
      history.past.push(history.last)

      if (history.past.length > 100) {
        history.past.shift()
      }

      history.future = []
      history.last = debouncedSnapKey
    }
  }, [debouncedSnapKey, hydrated])

  const undo = useCallback(() => {
    const history = historyRef.current

    if (history.past.length === 0) {
      return
    }

    const prev = history.past.pop()!
    history.future.push(snapRef.current)
    history.suppress = true
    history.last = prev
    applySnapshot(JSON.parse(prev))
  }, [applySnapshot])

  const redo = useCallback(() => {
    const history = historyRef.current

    if (history.future.length === 0) {
      return
    }

    const next = history.future.pop()!
    history.past.push(snapRef.current)
    history.suppress = true
    history.last = next
    applySnapshot(JSON.parse(next))
  }, [applySnapshot])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return
      }

      const tag = (event.target as HTMLElement | null)?.tagName

      if (tag === "INPUT" || tag === "TEXTAREA") {
        return
      }

      const key = event.key.toLowerCase()

      if (key === "z" && !event.shiftKey) {
        event.preventDefault()
        undo()
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault()
        redo()
      }
    }

    window.addEventListener("keydown", onKey)

    return () => window.removeEventListener("keydown", onKey)
  }, [undo, redo])

  return { undo, redo }
}
