import { useCallback, useEffect, useRef } from "react";
import { useSnapshot } from "valtio";

import { type Settings, settings, ui } from "~/components/texture-tool/store";
import { useDebounced } from "./use-debounced";

type Snap = Settings & { committedTrim: [number, number] };

export function useUndoRedo(hydrated: boolean) {
  const snap = useSnapshot(settings);
  const snapKey = JSON.stringify(snap);
  const snapRef = useRef(snapKey);
  snapRef.current = snapKey;

  const applySnapshot = useCallback((next: Snap) => {
    Object.assign(settings, next);
    ui.trim = [next.committedTrim[0], next.committedTrim[1]];
  }, []);

  const historyRef = useRef({
    past: [] as string[],
    future: [] as string[],
    last: snapKey,
    suppress: false,
  });
  const debouncedSnapKey = useDebounced(snapKey, 350);
  useEffect(() => {
    const h = historyRef.current;
    if (!hydrated) {
      h.last = debouncedSnapKey;
      return;
    }
    if (h.suppress) {
      h.suppress = false;
      h.last = debouncedSnapKey;
      return;
    }
    if (debouncedSnapKey !== h.last) {
      h.past.push(h.last);
      if (h.past.length > 100) h.past.shift();
      h.future = [];
      h.last = debouncedSnapKey;
    }
  }, [debouncedSnapKey, hydrated]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.past.length === 0) return;
    const prev = h.past.pop()!;
    h.future.push(snapRef.current);
    h.suppress = true;
    h.last = prev;
    applySnapshot(JSON.parse(prev));
  }, [applySnapshot]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const next = h.future.pop()!;
    h.past.push(snapRef.current);
    h.suppress = true;
    h.last = next;
    applySnapshot(JSON.parse(next));
  }, [applySnapshot]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  return { undo, redo };
}
