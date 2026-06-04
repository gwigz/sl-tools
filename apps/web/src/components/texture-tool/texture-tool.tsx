"use client";

import {
  ArrowRight,
  Box,
  Copy,
  Download,
  Grid3x3,
  ImageIcon,
  LoaderCircle,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ColorPicker } from "~/components/ui/color-picker";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import { Spinner } from "~/components/ui/spinner";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import {
  type AspectState,
  ASPECT_PRESETS,
  DEFAULT_ASPECT,
  describeAspect,
  resolveAspect,
} from "~/lib/sl/aspect";
import { canvasToBlob, composeSheet, type FitMode, type OverlayOptions } from "~/lib/sl/compose";
import { type FrameSampler, loadSource } from "~/lib/sl/extract";
import { autoGrid, chooseSheet } from "~/lib/sl/grid";
import { loadImageBitmap } from "~/lib/sl/image";
import { buildScript, type ScriptLanguage } from "~/lib/sl/lsl";

import { Dropzone } from "./dropzone";
import { ScriptBlock } from "./script-block";
import { SheetPreview } from "./sheet-preview";
import { SlPreview } from "./sl-preview";
import { LoopSeam } from "./loop-seam";
import { type TimelineThumb, TrimTimeline } from "./trim-timeline";

const LINK_TARGETS = [
  { value: "this", label: "This prim" },
  { value: "LINK_SET", label: "Whole linkset" },
  { value: "LINK_ROOT", label: "Root prim" },
  { value: "LINK_ALL_CHILDREN", label: "All children" },
  { value: "LINK_ALL_OTHERS", label: "All other prims" },
  { value: "specific", label: "Specific link #" },
];

const MAX_FRAMES = 256;
const DECODE_MAX = 1024;
const SOURCE_ACCEPT = "video/*,image/gif,image/webp,image/apng";
const OVERLAY_ACCEPT = "image/*,.tga,image/tga,image/x-tga,image/targa";
const OUTPUT_SIZES = [128, 256, 512, 1024, 2048];

const BLEND_MODES: { label: string; value: GlobalCompositeOperation }[] = [
  { label: "Normal", value: "source-over" },
  { label: "Multiply", value: "multiply" },
  { label: "Screen", value: "screen" },
  { label: "Overlay", value: "overlay" },
  { label: "Lighten", value: "lighten" },
  { label: "Darken", value: "darken" },
  { label: "Add", value: "lighter" },
];

interface SourceMeta {
  name: string;
  kind: FrameSampler["kind"];
  width: number;
  height: number;
  durationMs: number;
  nativeFrameCount: number;
}

const SETTINGS_KEY = "sl-texanim:settings:v1";
const OVERLAY_KEY = "sl-texanim:overlay:v1";

const DEFAULT_SETTINGS = {
  fps: 10,
  autoGridOn: true,
  manualCols: 4,
  manualRows: 4,
  maxSize: 2048,
  pow2: true,
  fit: "cover" as FitMode,
  transparent: true,
  background: "#000000",
  overlayEnabled: false,
  overlayOpacity: 1,
  overlayBlend: "source-over" as GlobalCompositeOperation,
  overlayFit: "stretch" as FitMode,
  overlayPerCell: true,
  loop: true,
  reverse: false,
  pingPong: false,
  scriptLang: "lsl" as ScriptLanguage,
  linkMode: "this",
  linkNum: 2,
  faceAll: true,
  faceNum: 0,
};

type Settings = typeof DEFAULT_SETTINGS;

// Skip bitmaps still referenced by `keep`; the image sampler reuses one across frames.
function closeFrames(toClose: ImageBitmap[], keep?: Set<ImageBitmap>) {
  const closed = new Set<ImageBitmap>();
  for (const bitmap of toClose) {
    if (keep?.has(bitmap) || closed.has(bitmap)) continue;
    closed.add(bitmap);
    bitmap.close();
  }
}

function rangeFromTrim(trim: [number, number], dur: number) {
  if (dur <= 0) return { start: 0, end: 1 };
  return { start: trim[0] / dur, end: trim[1] / dur };
}

// Downscale a frame to a tiny RGBA buffer for cheap similarity comparison.
function downscaleData(bitmap: ImageBitmap, size = 32): Uint8ClampedArray {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

function frameDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  return sum;
}

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(sec: number) {
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return `${sec.toFixed(1)}s`;
}

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function TextureTool() {
  const [sampler, setSampler] = useState<FrameSampler | null>(null);
  const [meta, setMeta] = useState<SourceMeta | null>(null);
  const [loadingSource, setLoadingSource] = useState(false);

  const [frames, setFrames] = useState<ImageBitmap[]>([]);
  const [frameCount, setFrameCount] = useState(16);
  const [fps, setFps] = useState(10);
  const [trim, setTrim] = useState<[number, number]>([0, 0]);
  const [committedTrim, setCommittedTrim] = useState<[number, number]>([0, 0]);
  const [timelineThumbs, setTimelineThumbs] = useState<TimelineThumb[]>([]);
  const [autoMatching, setAutoMatching] = useState(false);
  const [inFrame, setInFrame] = useState<ImageBitmap | null>(null);
  const [outFrame, setOutFrame] = useState<ImageBitmap | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [progress, setProgress] = useState(1);

  const [autoGridOn, setAutoGridOn] = useState(true);
  const [manualCols, setManualCols] = useState(4);
  const [manualRows, setManualRows] = useState(4);

  const [aspect, setAspect] = useState<AspectState>(DEFAULT_ASPECT);

  const [maxSize, setMaxSize] = useState(2048);
  const [pow2, setPow2] = useState(true);
  const [fit, setFit] = useState<FitMode>("cover");
  const [transparent, setTransparent] = useState(true);
  const [background, setBackground] = useState("#000000");

  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [overlayBitmap, setOverlayBitmap] = useState<ImageBitmap | null>(null);
  const [overlayName, setOverlayName] = useState<string | null>(null);
  const [overlayDataUrl, setOverlayDataUrl] = useState<string | null>(null);
  const [overlayOpacity, setOverlayOpacity] = useState(1);
  const [overlayBlend, setOverlayBlend] = useState<GlobalCompositeOperation>("source-over");
  const [overlayFit, setOverlayFit] = useState<FitMode>("stretch");
  const [overlayPerCell, setOverlayPerCell] = useState(true);

  const [loop, setLoop] = useState(true);
  const [reverse, setReverse] = useState(false);
  const [pingPong, setPingPong] = useState(false);
  const [scriptLang, setScriptLang] = useState<ScriptLanguage>("lsl");
  const [linkMode, setLinkMode] = useState("this");
  const [linkNum, setLinkNum] = useState(2);
  const [faceAll, setFaceAll] = useState(true);
  const [faceNum, setFaceNum] = useState(0);

  const [sheet, setSheet] = useState<HTMLCanvasElement | null>(null);

  const [hydrated, setHydrated] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [pngSize, setPngSize] = useState<number | null>(null);

  const sampleToken = useRef(0);
  const framesRef = useRef<ImageBitmap[]>([]);
  const debouncedCount = useDebounced(frameCount, 250);
  const debouncedCommittedTrim = useDebounced(committedTrim, 200);
  const commitTrim = useCallback((next: [number, number]) => {
    setTrim(next);
    setCommittedTrim(next);
  }, []);
  const durationSec = (meta?.durationMs ?? 0) / 1000;
  const regenerating = extracting || loadingSource;

  const faceAspect = resolveAspect(aspect);

  const { cols, rows } = useMemo(() => {
    if (autoGridOn) return autoGrid(frameCount);
    return { cols: Math.max(1, manualCols), rows: Math.max(1, manualRows) };
  }, [autoGridOn, frameCount, manualCols, manualRows]);

  const sheetDims = useMemo(
    () => chooseSheet(cols, rows, faceAspect, maxSize, pow2),
    [cols, rows, faceAspect, maxSize, pow2],
  );

  const cellCapacity = cols * rows;
  const placedFrames = Math.min(frameCount, cellCapacity);

  const applySettings = useCallback((s: Partial<Settings>) => {
    setFps(s.fps ?? DEFAULT_SETTINGS.fps);
    setAutoGridOn(s.autoGridOn ?? DEFAULT_SETTINGS.autoGridOn);
    setManualCols(s.manualCols ?? DEFAULT_SETTINGS.manualCols);
    setManualRows(s.manualRows ?? DEFAULT_SETTINGS.manualRows);
    setMaxSize(s.maxSize ?? DEFAULT_SETTINGS.maxSize);
    setPow2(s.pow2 ?? DEFAULT_SETTINGS.pow2);
    setFit(s.fit ?? DEFAULT_SETTINGS.fit);
    setTransparent(s.transparent ?? DEFAULT_SETTINGS.transparent);
    setBackground(s.background ?? DEFAULT_SETTINGS.background);
    setOverlayEnabled(s.overlayEnabled ?? DEFAULT_SETTINGS.overlayEnabled);
    setOverlayOpacity(s.overlayOpacity ?? DEFAULT_SETTINGS.overlayOpacity);
    setOverlayBlend(s.overlayBlend ?? DEFAULT_SETTINGS.overlayBlend);
    setOverlayFit(s.overlayFit ?? DEFAULT_SETTINGS.overlayFit);
    setOverlayPerCell(s.overlayPerCell ?? DEFAULT_SETTINGS.overlayPerCell);
    setLoop(s.loop ?? DEFAULT_SETTINGS.loop);
    setReverse(s.reverse ?? DEFAULT_SETTINGS.reverse);
    setPingPong(s.pingPong ?? DEFAULT_SETTINGS.pingPong);
    setScriptLang(s.scriptLang ?? DEFAULT_SETTINGS.scriptLang);
    setLinkMode(s.linkMode ?? DEFAULT_SETTINGS.linkMode);
    setLinkNum(s.linkNum ?? DEFAULT_SETTINGS.linkNum);
    setFaceAll(s.faceAll ?? DEFAULT_SETTINGS.faceAll);
    setFaceNum(s.faceNum ?? DEFAULT_SETTINGS.faceNum);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) applySettings(JSON.parse(raw) as Partial<Settings>);
    } catch {}
    (async () => {
      try {
        const raw = localStorage.getItem(OVERLAY_KEY);
        if (!raw) return;
        const { dataUrl, name } = JSON.parse(raw) as { dataUrl?: string; name?: string };
        if (!dataUrl) return;
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], name ?? "overlay", { type: blob.type });
        const bitmap = await loadImageBitmap(file);
        setOverlayBitmap(bitmap);
        setOverlayName(name ?? null);
        setOverlayDataUrl(dataUrl);
      } catch {}
    })();
    setHydrated(true);
  }, [applySettings]);

  useEffect(() => {
    if (!hydrated) return;
    const settings: Settings = {
      fps,
      autoGridOn,
      manualCols,
      manualRows,
      maxSize,
      pow2,
      fit,
      transparent,
      background,
      overlayEnabled,
      overlayOpacity,
      overlayBlend,
      overlayFit,
      overlayPerCell,
      loop,
      reverse,
      pingPong,
      scriptLang,
      linkMode,
      linkNum,
      faceAll,
      faceNum,
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {}
  }, [
    hydrated,
    fps,
    autoGridOn,
    manualCols,
    manualRows,
    maxSize,
    pow2,
    fit,
    transparent,
    background,
    overlayEnabled,
    overlayOpacity,
    overlayBlend,
    overlayFit,
    overlayPerCell,
    loop,
    reverse,
    pingPong,
    scriptLang,
    linkMode,
    linkNum,
    faceAll,
    faceNum,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (overlayDataUrl && overlayName) {
        localStorage.setItem(
          OVERLAY_KEY,
          JSON.stringify({ dataUrl: overlayDataUrl, name: overlayName }),
        );
      } else {
        localStorage.removeItem(OVERLAY_KEY);
      }
    } catch {}
  }, [hydrated, overlayDataUrl, overlayName]);

  const handleReset = useCallback(() => {
    try {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(OVERLAY_KEY);
    } catch {}
    applySettings(DEFAULT_SETTINGS);
    setOverlayBitmap((prev) => {
      prev?.close();
      return null;
    });
    setOverlayName(null);
    setOverlayDataUrl(null);
    setResetOpen(false);
    toast.success("Settings reset to defaults");
  }, [applySettings]);

  const handleSelect = useCallback(async (file: File) => {
    setLoadingSource(true);
    try {
      const next = await loadSource(file);
      // Guard against still images (e.g. a static PNG): this tool needs motion.
      const animated = next.nativeFrameCount >= 2 || (next.kind === "video" && next.durationMs > 0);
      if (!animated) {
        next.dispose();
        toast.error("Choose an animated source — a video, GIF, or animated WebP");
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
      });

      setTrim([0, next.durationMs / 1000]);
      setCommittedTrim([0, next.durationMs / 1000]);
      if (next.kind === "image") {
        setFrameCount(1);
      } else {
        setFrameCount(Math.min(MAX_FRAMES, Math.max(1, next.nativeFrameCount || 16)));
      }
      if (next.kind === "animated" && next.durationMs > 0) {
        const rate = next.nativeFrameCount / (next.durationMs / 1000);
        if (Number.isFinite(rate) && rate > 0) {
          setFps(Math.min(30, Math.max(1, Math.round(rate))));
        }
      }
      if (next.width > 0 && next.height > 0) {
        setAspect((a) => ({
          ...a,
          mode: "pixels",
          pixelW: next.width,
          pixelH: next.height,
        }));
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
    const count = Math.max(1, Math.min(MAX_FRAMES, debouncedCount));
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
          closeFrames(framesRef.current, new Set(next));
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
  }, [sampler, debouncedCount, debouncedCommittedTrim]);

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

  const frameStep =
    meta && meta.nativeFrameCount > 0 && durationSec > 0
      ? durationSec / meta.nativeFrameCount
      : 1 / 30;

  const handleAutoMatch = useCallback(async () => {
    if (!sampler || durationSec <= 0 || frames.length < 2) return;
    setAutoMatching(true);
    try {
      const startT = trim[0];
      const endT = trim[1];
      const window = Math.min(durationSec * 0.15, Math.max(frameStep * 8, (endT - startT) * 0.3));
      const lo = Math.max(startT + frameStep, endT - window);
      const hi = Math.min(durationSec, endT + window);
      const k = 16;
      const candTimes = Array.from({ length: k }, (_, i) => lo + (i / (k - 1)) * (hi - lo));
      const decoded = await sampler.sampleAtTimes([startT, ...candTimes], { maxDecodeSize: 64 });
      const reference = downscaleData(decoded[0]);
      let bestScore = Infinity;
      let bestTime = endT;
      for (let i = 1; i < decoded.length; i++) {
        const score = frameDiff(reference, downscaleData(decoded[i]));
        if (score < bestScore) {
          bestScore = score;
          bestTime = candTimes[i - 1];
        }
      }
      for (const b of decoded) b.close();
      const matched: [number, number] = [
        trim[0],
        Math.min(durationSec, Math.max(trim[0] + frameStep, bestTime)),
      ];
      setTrim(matched);
      setCommittedTrim(matched);
      toast.success("Snapped to the cleanest loop point");
    } catch {
      toast.error("Auto-match failed");
    } finally {
      setAutoMatching(false);
    }
  }, [sampler, durationSec, frames.length, trim, frameStep]);

  // Live in/out previews that update while dragging, ahead of re-extraction.
  const liveTrim = useDebounced(trim, 80);
  const inFrameRef = useRef<ImageBitmap | null>(null);
  const outFrameRef = useRef<ImageBitmap | null>(null);
  useEffect(() => {
    if (!sampler || durationSec <= 0) return;
    let cancelled = false;
    sampler
      .sampleAtTimes([liveTrim[0], liveTrim[1]], { maxDecodeSize: 220 })
      .then(([a, b]) => {
        if (cancelled) {
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
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sampler, liveTrim, durationSec]);
  useEffect(
    () => () => {
      inFrameRef.current?.close();
      outFrameRef.current?.close();
    },
    [],
  );

  const handleOverlay = useCallback(async (file: File) => {
    try {
      const [bitmap, dataUrl] = await Promise.all([loadImageBitmap(file), fileToDataUrl(file)]);
      setOverlayBitmap((prev) => {
        prev?.close();
        return bitmap;
      });
      setOverlayName(file.name);
      setOverlayDataUrl(dataUrl);
    } catch {
      toast.error("Could not load overlay image");
    }
  }, []);

  useEffect(() => {
    if (frames.length === 0) {
      setSheet(null);
      return;
    }
    const overlay: OverlayOptions | null =
      overlayEnabled && overlayBitmap
        ? {
            bitmap: overlayBitmap,
            opacity: overlayOpacity,
            blend: overlayBlend,
            fit: overlayFit,
            perCell: overlayPerCell,
          }
        : null;

    setSheet(
      composeSheet({
        frames,
        cols,
        rows,
        sheetWidth: sheetDims.sheetWidth,
        sheetHeight: sheetDims.sheetHeight,
        fit,
        background: transparent ? "transparent" : background,
        overlay,
      }),
    );
  }, [
    frames,
    cols,
    rows,
    sheetDims.sheetWidth,
    sheetDims.sheetHeight,
    fit,
    transparent,
    background,
    overlayEnabled,
    overlayBitmap,
    overlayOpacity,
    overlayBlend,
    overlayFit,
    overlayPerCell,
  ]);

  const link = linkMode === "this" ? null : linkMode === "specific" ? String(linkNum) : linkMode;
  const face = faceAll ? "ALL_SIDES" : String(faceNum);

  const script = useMemo(
    () =>
      buildScript(scriptLang, {
        cols,
        rows,
        fps,
        frameCount: placedFrames,
        loop,
        reverse,
        pingPong,
        face,
        link,
      }),
    [scriptLang, cols, rows, fps, placedFrames, loop, reverse, pingPong, face, link],
  );

  // --- Undo / redo across all settings ----------------------------------------
  const snapshot = useMemo(
    () => ({
      fps,
      frameCount,
      committedTrim,
      autoGridOn,
      manualCols,
      manualRows,
      aspect,
      maxSize,
      pow2,
      fit,
      transparent,
      background,
      overlayEnabled,
      overlayOpacity,
      overlayBlend,
      overlayFit,
      overlayPerCell,
      loop,
      reverse,
      pingPong,
      scriptLang,
      linkMode,
      linkNum,
      faceAll,
      faceNum,
    }),
    [
      fps,
      frameCount,
      committedTrim,
      autoGridOn,
      manualCols,
      manualRows,
      aspect,
      maxSize,
      pow2,
      fit,
      transparent,
      background,
      overlayEnabled,
      overlayOpacity,
      overlayBlend,
      overlayFit,
      overlayPerCell,
      loop,
      reverse,
      pingPong,
      scriptLang,
      linkMode,
      linkNum,
      faceAll,
      faceNum,
    ],
  );
  type Snap = typeof snapshot;
  const snapKey = JSON.stringify(snapshot);
  const snapRef = useRef(snapKey);
  snapRef.current = snapKey;

  const applySnapshot = useCallback((snap: Snap) => {
    setFps(snap.fps);
    setFrameCount(snap.frameCount);
    setTrim(snap.committedTrim);
    setCommittedTrim(snap.committedTrim);
    setAutoGridOn(snap.autoGridOn);
    setManualCols(snap.manualCols);
    setManualRows(snap.manualRows);
    setAspect(snap.aspect);
    setMaxSize(snap.maxSize);
    setPow2(snap.pow2);
    setFit(snap.fit);
    setTransparent(snap.transparent);
    setBackground(snap.background);
    setOverlayEnabled(snap.overlayEnabled);
    setOverlayOpacity(snap.overlayOpacity);
    setOverlayBlend(snap.overlayBlend);
    setOverlayFit(snap.overlayFit);
    setOverlayPerCell(snap.overlayPerCell);
    setLoop(snap.loop);
    setReverse(snap.reverse);
    setPingPong(snap.pingPong);
    setScriptLang(snap.scriptLang);
    setLinkMode(snap.linkMode);
    setLinkNum(snap.linkNum);
    setFaceAll(snap.faceAll);
    setFaceNum(snap.faceNum);
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
    applySnapshot(JSON.parse(prev) as Snap);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.future.length === 0) return;
    const next = h.future.pop()!;
    h.past.push(snapRef.current);
    h.suppress = true;
    h.last = next;
    applySnapshot(JSON.parse(next) as Snap);
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

  const baseName = meta?.name.replace(/\.[^.]+$/, "") ?? "texture";

  useEffect(() => {
    if (!sheet) {
      setPngSize(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      canvasToBlob(sheet)
        .then((blob) => {
          if (!cancelled) setPngSize(blob.size);
        })
        .catch(() => {});
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [sheet]);

  const handleDownload = useCallback(async () => {
    if (!sheet) return;
    const blob = await canvasToBlob(sheet);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${baseName}_${cols}x${rows}_${fps}fps.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sheet, baseName, cols, rows, fps]);

  const copyScript = useCallback(() => {
    navigator.clipboard
      .writeText(script)
      .then(() => toast.success("Script copied"))
      .catch(() => toast.error("Clipboard unavailable"));
  }, [script]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)] lg:items-start">
      <div className="flex items-start justify-between gap-4 lg:col-span-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Media to{" "}
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-primary">
              llSetTextureAnim
            </code>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Runs entirely in your browser, nothing is uploaded
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 text-muted-foreground"
          onClick={() => setResetOpen(true)}
        >
          <RotateCcw /> Reset
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="size-4" /> Source
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Dropzone
              onSelect={handleSelect}
              accept={SOURCE_ACCEPT}
              compact={!!meta}
              preview={meta ? (frames[0] ?? null) : null}
              label={meta?.name}
            />
            {loadingSource && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin" /> Decoding…
              </p>
            )}
            {meta && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge variant="secondary">{meta.kind}</Badge>
                <Badge variant="outline">
                  {meta.width}×{meta.height}px
                </Badge>
                {meta.durationMs > 0 && (
                  <Badge variant="outline">{(meta.durationMs / 1000).toFixed(1)}s</Badge>
                )}
                {meta.nativeFrameCount > 0 && (
                  <Badge variant="outline">{meta.nativeFrameCount} native frames</Badge>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Grid3x3 className="size-4" /> Frames &amp; Grid
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <SliderField
              label="Frames"
              value={frameCount}
              min={1}
              max={meta?.kind === "image" ? 1 : MAX_FRAMES}
              step={1}
              onChange={setFrameCount}
            />
            <SliderField
              label="FPS"
              value={fps}
              min={1}
              max={30}
              step={1}
              onChange={setFps}
              suffix="fps"
            />
            {meta && durationSec > 0 && (
              <>
                <CardDivider />
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Trim &amp; Loop</Label>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatTime(trim[0])} to {formatTime(trim[1])}
                    </span>
                  </div>
                  <TrimTimeline
                    durationSec={durationSec}
                    thumbs={timelineThumbs}
                    value={trim}
                    frameStep={frameStep}
                    onChange={setTrim}
                    onCommit={commitTrim}
                    requestFrame={requestFrame}
                  />
                  {frames.length > 1 && (
                    <LoopSeam
                      frames={frames}
                      inFrame={inFrame}
                      outFrame={outFrame}
                      startTime={trim[0]}
                      endTime={trim[1]}
                      faceAspect={faceAspect}
                      onAutoMatch={handleAutoMatch}
                      autoMatching={autoMatching}
                    />
                  )}
                </div>
              </>
            )}

            <CardDivider />

            <SwitchRow
              label="Auto Grid"
              hint="Choose rows and columns automatically"
              checked={autoGridOn}
              onChange={setAutoGridOn}
            />
            {!autoGridOn && (
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Columns"
                  value={manualCols}
                  min={1}
                  max={255}
                  onChange={setManualCols}
                />
                <NumberField
                  label="Rows"
                  value={manualRows}
                  min={1}
                  max={255}
                  onChange={setManualRows}
                />
              </div>
            )}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {cols} × {rows} grid ({cellCapacity} cells)
              </span>
              <span>{placedFrames} placed</span>
            </div>
            {frameCount > cellCapacity && (
              <p className="text-xs text-destructive">
                {`${frameCount - cellCapacity} frame(s) won't fit. Add more rows or columns.`}
              </p>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4" /> Output
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Label className="text-xs">Face Aspect</Label>
              <Tabs
                value={aspect.mode}
                onValueChange={(v) => setAspect((a) => ({ ...a, mode: v as AspectState["mode"] }))}
              >
                <TabsList className="w-full">
                  <TabsTrigger value="preset" className="flex-1">
                    Preset
                  </TabsTrigger>
                  <TabsTrigger value="pixels" className="flex-1">
                    Pixels
                  </TabsTrigger>
                  <TabsTrigger value="meters" className="flex-1">
                    Meters
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {aspect.mode === "preset" && (
                <Select
                  value={aspect.preset}
                  onValueChange={(v) => setAspect((a) => ({ ...a, preset: v ?? a.preset }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ASPECT_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {aspect.mode === "pixels" && (
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Width (px)"
                    value={aspect.pixelW}
                    min={1}
                    max={4096}
                    onChange={(v) => setAspect((a) => ({ ...a, pixelW: v }))}
                  />
                  <NumberField
                    label="Height (px)"
                    value={aspect.pixelH}
                    min={1}
                    max={4096}
                    onChange={(v) => setAspect((a) => ({ ...a, pixelH: v }))}
                  />
                </div>
              )}
              {aspect.mode === "meters" && (
                <div className="grid grid-cols-2 gap-3">
                  <NumberField
                    label="Width (m)"
                    value={aspect.meterW}
                    min={0.01}
                    max={64}
                    step={0.1}
                    onChange={(v) => setAspect((a) => ({ ...a, meterW: v }))}
                  />
                  <NumberField
                    label="Height (m)"
                    value={aspect.meterH}
                    min={0.01}
                    max={64}
                    step={0.1}
                    onChange={(v) => setAspect((a) => ({ ...a, meterH: v }))}
                  />
                </div>
              )}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                Face {describeAspect(aspect)}
                <ArrowRight className="size-3" />
                ratio {faceAspect.toFixed(3)}:1
              </p>
            </div>

            <CardDivider />

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Max Size</Label>
                <Select value={String(maxSize)} onValueChange={(v) => setMaxSize(Number(v))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTPUT_SIZES.map((s) => (
                      <SelectItem key={s} value={String(s)}>
                        {s}px
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Frame Fit</Label>
                <Select value={fit} onValueChange={(v) => setFit(v as FitMode)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cover">Cover (crop)</SelectItem>
                    <SelectItem value="contain">Contain (letterbox)</SelectItem>
                    <SelectItem value="stretch">Stretch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <SwitchRow
              label="Power-of-Two"
              hint="Required for Second Life. Sizes 8 to 2048, can be non-square."
              checked={pow2}
              onChange={setPow2}
            />
            <SwitchRow
              label="Transparent Background"
              checked={transparent}
              onChange={setTransparent}
            />
            {!transparent && (
              <div className="flex items-center justify-between gap-3">
                <Label className="text-xs">Background Color</Label>
                <ColorPicker value={background} onChange={setBackground} alpha />
              </div>
            )}

            <CardDivider />

            <SwitchRow
              label="Overlay Texture"
              hint="Composite an image on top of every frame"
              checked={overlayEnabled}
              onChange={setOverlayEnabled}
            />
            {overlayEnabled && (
              <>
                <Dropzone
                  onSelect={handleOverlay}
                  accept={OVERLAY_ACCEPT}
                  compact
                  preview={overlayBitmap}
                  label={overlayName ?? "Choose Overlay (PNG, TGA…)"}
                />
                <SliderField
                  label="Opacity"
                  value={Math.round(overlayOpacity * 100)}
                  min={0}
                  max={100}
                  step={1}
                  onChange={(v) => setOverlayOpacity(v / 100)}
                  suffix="%"
                />
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Blend</Label>
                    <Select
                      value={overlayBlend}
                      onValueChange={(v) => setOverlayBlend(v as GlobalCompositeOperation)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BLEND_MODES.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs">Fit</Label>
                    <Select value={overlayFit} onValueChange={(v) => setOverlayFit(v as FitMode)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="stretch">Stretch</SelectItem>
                        <SelectItem value="cover">Cover</SelectItem>
                        <SelectItem value="contain">Contain</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <SwitchRow
                  label="Apply Per Frame"
                  hint="Draw on each cell instead of the whole sheet"
                  checked={overlayPerCell}
                  onChange={setOverlayPerCell}
                />
              </>
            )}
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Box className="size-4" /> Apply In-World
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <Tabs value={scriptLang} onValueChange={(v) => setScriptLang(v as ScriptLanguage)}>
                <TabsList>
                  <TabsTrigger value="lsl">LSL</TabsTrigger>
                  <TabsTrigger value="slua">SLua</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button variant="outline" size="sm" onClick={copyScript}>
                <Copy /> Copy
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Target Link</Label>
                <Select value={linkMode} onValueChange={(v) => setLinkMode(v ?? "this")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINK_TARGETS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Face</Label>
                <Select
                  value={faceAll ? "all" : "specific"}
                  onValueChange={(v) => setFaceAll(v === "all")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All faces (ALL_SIDES)</SelectItem>
                    <SelectItem value="specific">Specific face #</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {(linkMode === "specific" || !faceAll) && (
              <div className="grid grid-cols-2 gap-3">
                {linkMode === "specific" ? (
                  <NumberField
                    label="Link Number"
                    value={linkNum}
                    min={1}
                    max={255}
                    onChange={setLinkNum}
                  />
                ) : (
                  <span />
                )}
                {!faceAll ? (
                  <NumberField
                    label="Face Number"
                    value={faceNum}
                    min={0}
                    max={8}
                    onChange={setFaceNum}
                  />
                ) : (
                  <span />
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-4">
              <SwitchRow label="Loop" checked={loop} onChange={setLoop} inline />
              <SwitchRow label="Reverse" checked={reverse} onChange={setReverse} inline />
              <SwitchRow label="Ping-Pong" checked={pingPong} onChange={setPingPong} inline />
            </div>
            <ScriptBlock code={script} />
            <p className="text-xs text-muted-foreground">
              Upload the PNG as a texture, drop it on the prim, then paste this into a new{" "}
              {scriptLang === "slua" ? "SLua" : "LSL"} script.
            </p>
          </CardContent>
        </Card>
      </div>

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Reset all settings?</DialogTitle>
          <DialogDescription>
            This clears your saved preferences and overlay texture and restores the defaults. Your
            current source stays loaded.
          </DialogDescription>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={handleReset}>
              Reset
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-3 lg:sticky lg:top-4">
        <Card size="sm">
          <Tabs defaultValue="preview">
            <CardHeader>
              <TabsList className="w-full">
                <TabsTrigger value="preview" className="flex-1">
                  Preview
                </TabsTrigger>
                <TabsTrigger value="sheet" className="flex-1">
                  Sheet
                </TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <TabsContent value="preview">
                <SlPreview
                  sheet={sheet}
                  cols={cols}
                  rows={rows}
                  frameCount={placedFrames}
                  fps={fps}
                  faceAspect={faceAspect}
                  reverse={reverse}
                  pingPong={pingPong}
                  loop={loop}
                />
              </TabsContent>
              <TabsContent value="sheet">
                <SheetPreview sheet={sheet} cols={cols} rows={rows} />
              </TabsContent>

              <CardDivider />

              <Button
                size="lg"
                className="w-full"
                onClick={handleDownload}
                disabled={!sheet || regenerating}
              >
                {regenerating ? <Spinner /> : <Download />}
                {regenerating ? "Regenerating…" : "Download texture PNG"}
              </Button>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {sheetDims.sheetWidth}×{sheetDims.sheetHeight}px
                  {pngSize !== null && ` · ${formatBytes(pngSize)}`}
                </span>
                <span>
                  {cols}×{rows} grid · {placedFrames} frames
                </span>
              </div>
              {extracting && (
                <div className="flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${Math.round(progress * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {Math.round(progress * 100)}%
                  </span>
                </div>
              )}
            </CardContent>
          </Tabs>
        </Card>
      </div>
    </div>
  );
}

// Full-bleed section divider: stretches to the card edges past CardContent padding.
function CardDivider() {
  return <div className="-mx-3 my-1.5 h-px bg-foreground/10" />;
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
            }}
            className="w-12 rounded bg-transparent text-right tabular-nums outline-none focus:text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {suffix && <span>{suffix}</span>}
        </div>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </div>
  );
}

function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  inline = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <Switch checked={checked} onCheckedChange={onChange} />
        {label}
      </label>
    );
  }
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-xs font-medium">{label}</span>
        {hint && <span className="text-[0.7rem] text-muted-foreground">{hint}</span>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
