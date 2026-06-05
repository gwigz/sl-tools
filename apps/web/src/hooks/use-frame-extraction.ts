import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useSnapshot } from "valtio";

import { settings, ui } from "~/components/texture-tool/store";
import type { TimelineThumb } from "~/components/texture-tool/trim-timeline";
import { type FrameSampler, loadSource } from "~/lib/sl/extract";
import { closeFrames, rangeFromTrim } from "~/lib/sl/frames";
import { useDebounced } from "./use-debounced";

const MAX_FRAMES = 256;
const DECODE_MAX = 1024;

export interface SourceMeta {
  name: string;
  kind: FrameSampler["kind"];
  width: number;
  height: number;
  durationMs: number;
  nativeFrameCount: number;
  frameRate: number;
}

export function useFrameExtraction({ targetFrames }: { targetFrames: number }) {
  const [sampler, setSampler] = useState<FrameSampler | null>(null);
  const [meta, setMeta] = useState<SourceMeta | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);
  const [frames, setFrames] = useState<ImageBitmap[]>([]);
  const [timelineThumbs, setTimelineThumbs] = useState<TimelineThumb[]>([]);
  const [inFrame, setInFrame] = useState<ImageBitmap | null>(null);
  const [outFrame, setOutFrame] = useState<ImageBitmap | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(1);

  const sampleToken = useRef(0);
  const framesRef = useRef<ImageBitmap[]>([]);
  const loadedOnceRef = useRef(false);

  const durationSec = (meta?.durationMs ?? 0) / 1000;
  const frameStep =
    meta && meta.nativeFrameCount > 0 && durationSec > 0
      ? durationSec / meta.nativeFrameCount
      : 1 / 30;

  const committedTrim = useSnapshot(settings).committedTrim as [number, number];
  const debouncedCommittedTrim = useDebounced(committedTrim, 200);
  const debouncedTargetFrames = useDebounced(targetFrames, 250);

  const handleSelect = useCallback(async (file: File) => {
    setLoadingSource(true);
    try {
      const next = await loadSource(file);
      const animated = next.nativeFrameCount >= 2 || (next.kind === "video" && next.durationMs > 0);
      if (!animated) {
        next.dispose();
        toast.error("Choose an animated source, such as a video, GIF, or animated WebP");
        return;
      }
      setSampler((prev) => {
        prev?.dispose();
        return next;
      });
      setMeta({
        name: file.name,
        kind: next.kind,
        width: next.width,
        height: next.height,
        durationMs: next.durationMs,
        nativeFrameCount: next.nativeFrameCount,
        frameRate: next.frameRate,
      });

      const firstLoad = !loadedOnceRef.current;
      loadedOnceRef.current = true;

      const dur = next.durationMs / 1000;
      const loopLen = dur > 0 ? Math.min(2, dur) : 0;
      ui.trim = [0, loopLen];
      settings.committedTrim = [0, loopLen];
      ui.view = [0, dur > 0 ? dur : 1];

      if (next.frameRate > 0) {
        settings.fps = Math.min(60, Math.max(1, Math.round(next.frameRate)));
      }

      if (firstLoad && next.width > 0 && next.height > 0) {
        settings.aspect = {
          ...settings.aspect,
          mode: "pixels",
          pixelW: next.width,
          pixelH: next.height,
        };
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load that file");
    } finally {
      setLoadingSource(false);
    }
  }, []);

  useEffect(() => {
    if (!sampler) return;
    const token = ++sampleToken.current;
    const count = Math.max(1, Math.min(MAX_FRAMES, debouncedTargetFrames));
    setExtracting(true);
    setProgress(0);
    sampler
      .sampleByCount(count, {
        maxDecodeSize: DECODE_MAX,
        range: rangeFromTrim(debouncedCommittedTrim, durationSec),
        onProgress: (f) => {
          if (token === sampleToken.current) setProgress(f);
        },
      })
      .then((next) => {
        if (token === sampleToken.current) {
          framesRef.current = next;
          setFrames(next);
          setExtracting(false);
        } else {
          closeFrames(next, new Set(framesRef.current));
        }
      })
      .catch(() => {
        if (token === sampleToken.current) setExtracting(false);
        toast.error("Failed to extract frames");
      });
  }, [sampler, debouncedTargetFrames, debouncedCommittedTrim]);

  // Free the prior frame generation only after the new one has committed, so no
  // live consumer is ever holding a closed bitmap mid-draw.
  const prevFramesRef = useRef<ImageBitmap[]>([]);
  useEffect(() => {
    const prev = prevFramesRef.current;
    prevFramesRef.current = frames;
    if (prev !== frames) closeFrames(prev, new Set(frames));
  }, [frames]);
  useEffect(() => () => closeFrames(framesRef.current), []);

  // Whole-clip thumbnails for the trim timeline (one decode pass per source).
  const timelineRef = useRef<TimelineThumb[]>([]);
  useEffect(() => {
    if (!sampler || sampler.durationMs <= 0) {
      setTimelineThumbs([]);
      return;
    }
    let cancelled = false;
    const dur = sampler.durationMs / 1000;
    const count = 24;
    const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * dur);
    sampler
      .sampleAtTimes(times, { maxDecodeSize: 128 })
      .then((bitmaps) => {
        if (cancelled) {
          for (const b of bitmaps) b.close();
          return;
        }
        const next = times.map((t, i) => ({ time: t, bitmap: bitmaps[i] }));
        timelineRef.current = next;
        setTimelineThumbs(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      for (const t of timelineRef.current) t.bitmap.close();
      timelineRef.current = [];
    };
  }, [sampler]);

  const requestFrame = useCallback(
    async (t: number) => {
      if (!sampler) return null;
      const [bmp] = await sampler.sampleAtTimes([t], { maxDecodeSize: 200 });
      return bmp ?? null;
    },
    [sampler],
  );

  // Live in/out previews that update while dragging/stepping, ahead of re-extraction.
  // Decode-latest with an in-flight guard (not a debounce) so per-frame steps still
  // render intermediate frames instead of only the value you settle on.
  const liveTrim = useSnapshot(ui).trim as [number, number];
  const inFrameRef = useRef<ImageBitmap | null>(null);
  const outFrameRef = useRef<ImageBitmap | null>(null);
  const liveBusy = useRef(false);
  const liveQueued = useRef<[number, number] | null>(null);
  const disposedRef = useRef(false);
  const runLivePreview = useCallback(
    (t0: number, t1: number) => {
      if (!sampler || durationSec <= 0) return;
      if (liveBusy.current) {
        liveQueued.current = [t0, t1];
        return;
      }
      liveBusy.current = true;
      sampler
        .sampleAtTimes([t0, t1], { maxDecodeSize: 220 })
        .then(([a, b]) => {
          if (disposedRef.current) {
            a?.close();
            b?.close();
            return;
          }
          inFrameRef.current?.close();
          inFrameRef.current = a ?? null;
          setInFrame(a ?? null);
          outFrameRef.current?.close();
          outFrameRef.current = b ?? null;
          setOutFrame(b ?? null);
        })
        .catch(() => {})
        .finally(() => {
          liveBusy.current = false;
          const next = liveQueued.current;
          if (next) {
            liveQueued.current = null;
            runLivePreview(next[0], next[1]);
          }
        });
    },
    [sampler, durationSec],
  );
  useEffect(() => {
    runLivePreview(liveTrim[0], liveTrim[1]);
  }, [liveTrim, runLivePreview]);
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      inFrameRef.current?.close();
      outFrameRef.current?.close();
    };
  }, []);

  return {
    sampler,
    meta,
    loadingSource,
    frames,
    timelineThumbs,
    inFrame,
    outFrame,
    extracting,
    progress,
    durationSec,
    frameStep,
    handleSelect,
    requestFrame,
  };
}
