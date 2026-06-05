import { loadImageBitmap } from "./image";

export type SourceKind = "video" | "animated" | "image";

export interface SampleOptions {
  maxDecodeSize?: number;
  range?: { start: number; end: number };
  onProgress?: (fraction: number) => void;
}

function resolveRange(range: SampleOptions["range"]): [number, number] {
  const start = Math.min(0.999, Math.max(0, range?.start ?? 0));
  const end = Math.max(start + 0.001, Math.min(1, range?.end ?? 1));
  return [start, end];
}

export interface FrameSampler {
  kind: SourceKind;
  width: number;
  height: number;
  durationMs: number;
  nativeFrameCount: number;
  frameRate: number;
  sampleByCount: (n: number, opts?: SampleOptions) => Promise<ImageBitmap[]>;
  sampleAtTimes: (timesSec: number[], opts?: SampleOptions) => Promise<ImageBitmap[]>;
  dispose: () => void;
}

const ANIMATED_TYPES = ["image/gif", "image/webp", "image/apng", "image/png"];
const VIDEO_POOL_SIZE = 4;

export function detectKind(file: File) {
  if (file.type.startsWith("video/")) return "video";
  if (ANIMATED_TYPES.includes(file.type)) return "animated";
  return "image";
}

export async function loadSource(file: File) {
  const kind = detectKind(file);
  if (kind === "video") {
    return (await loadVideoWebCodecs(file)) ?? loadVideo(file);
  }
  if (kind === "animated") {
    try {
      return await loadAnimated(file);
    } catch {
      return loadImage(file);
    }
  }
  return loadImage(file);
}

function resizeOptions(
  w: number,
  h: number,
  max: number | undefined,
): ImageBitmapOptions | undefined {
  const longest = Math.max(w, h);
  if (!max || longest <= max || longest === 0) return undefined;
  const scale = max / longest;
  return {
    resizeWidth: Math.max(1, Math.round(w * scale)),
    resizeHeight: Math.max(1, Math.round(h * scale)),
    resizeQuality: "high",
  };
}

function createVideoEl(src: string) {
  const video = document.createElement("video");
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  return video;
}

function whenReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 2) return resolve();
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("Could not load this video file"));
  });
}

function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    const max = Math.max(0, (video.duration || 0) - 1e-3);
    video.currentTime = Math.max(0, Math.min(t, max));
  });
}

function sinkSize(w: number, h: number, max: number | undefined) {
  const longest = Math.max(w, h);
  if (!max || longest <= max || longest === 0) return { width: w, height: h };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

async function blankBitmap() {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  return createImageBitmap(canvas);
}

async function snapToKeyframes(
  packetSink: import("mediabunny").EncodedPacketSink,
  targets: number[],
) {
  try {
    const keyTimes = await Promise.all(
      targets.map((t) =>
        packetSink
          .getKeyPacket(t, { metadataOnly: true })
          .then((key) => key?.timestamp ?? t)
          .catch(() => t),
      ),
    );
    const used = new Set<number>();
    return keyTimes.map((kt, i) => {
      if (used.has(kt)) return targets[i];
      used.add(kt);
      return kt;
    });
  } catch {
    return targets;
  }
}

async function loadVideoWebCodecs(file: File): Promise<FrameSampler | null> {
  if (typeof VideoDecoder === "undefined") return null;
  try {
    const { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input } =
      await import("mediabunny");
    const input = new Input({
      formats: ALL_FORMATS,
      source: new BlobSource(file),
    });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      return null;
    }

    const width = track.displayWidth;
    const height = track.displayHeight;
    const duration = await track.computeDuration();
    let frameRate = 0;
    try {
      frameRate = (await track.computePacketStats(60)).averagePacketRate;
    } catch {}

    const packetSink = new EncodedPacketSink(track);
    let sink: import("mediabunny").CanvasSink | null = null;
    let sinkKey = "";
    let lock: Promise<unknown> = Promise.resolve();

    const decodeAt = async (times: number[], opts?: SampleOptions) => {
      const size = sinkSize(width, height, opts?.maxDecodeSize);
      const key = `${size.width}x${size.height}`;
      if (!sink || sinkKey !== key) {
        sink = new CanvasSink(track, { ...size, fit: "fill", poolSize: 2 });
        sinkKey = key;
      }
      const timestamps = await snapToKeyframes(packetSink, times);
      const out: ImageBitmap[] = [];
      let done = 0;
      for await (const wrapped of sink.canvasesAtTimestamps(timestamps)) {
        if (wrapped) {
          out.push(await createImageBitmap(wrapped.canvas));
        } else {
          out.push(out.at(-1) ?? (await blankBitmap()));
        }
        done++;
        opts?.onProgress?.(done / times.length);
      }
      return out;
    };

    const serialize = <T>(fn: () => Promise<T>): Promise<T> => {
      const result = lock.then(fn, fn);
      lock = result.then(
        () => {},
        () => {},
      );
      return result;
    };

    return {
      kind: "video",
      width,
      height,
      durationMs: duration * 1000,
      nativeFrameCount: 0,
      frameRate,
      sampleByCount(n, opts) {
        return serialize(() => {
          const [a, b] = resolveRange(opts?.range);
          const targets = Array.from({ length: n }, (_, i) =>
            duration === 0 ? 0 : (a + ((i + 0.5) / n) * (b - a)) * duration,
          );
          return decodeAt(targets, opts);
        });
      },
      sampleAtTimes(times, opts) {
        return serialize(() => decodeAt(times, opts));
      },
      dispose() {
        input.dispose();
      },
    };
  } catch {
    return null;
  }
}

async function loadVideo(file: File): Promise<FrameSampler> {
  const url = URL.createObjectURL(file);
  const lead = createVideoEl(url);
  await whenReady(lead);

  const width = lead.videoWidth;
  const height = lead.videoHeight;
  const duration = Number.isFinite(lead.duration) ? lead.duration : 0;

  const seekFrames = async (targets: number[], opts?: SampleOptions) => {
    const resize = resizeOptions(width, height, opts?.maxDecodeSize);
    const n = targets.length;
    const results: ImageBitmap[] = Array.from({ length: n });
    let done = 0;

    const poolSize = Math.max(1, Math.min(VIDEO_POOL_SIZE, n));
    const extras = Array.from({ length: poolSize - 1 }, () => createVideoEl(url));
    const pool = [lead, ...extras];
    await Promise.all(extras.map(whenReady));

    const runSeeker = async (video: HTMLVideoElement, offset: number) => {
      for (let i = offset; i < n; i += poolSize) {
        await seekTo(video, targets[i]);
        results[i] = await createImageBitmap(video, resize);
        done++;
        opts?.onProgress?.(done / n);
      }
    };

    try {
      await Promise.all(pool.map((video, i) => runSeeker(video, i)));
    } finally {
      for (const v of extras) {
        v.removeAttribute("src");
        v.load();
      }
    }
    return results;
  };

  return {
    kind: "video",
    width,
    height,
    durationMs: duration * 1000,
    nativeFrameCount: 0,
    frameRate: 0,
    sampleByCount(n, opts) {
      const [a, b] = resolveRange(opts?.range);
      const targets = Array.from({ length: n }, (_, i) =>
        duration === 0 ? 0 : (a + ((i + 0.5) / n) * (b - a)) * duration,
      );
      return seekFrames(targets, opts);
    },
    sampleAtTimes(times, opts) {
      return seekFrames(times, opts);
    },
    dispose() {
      lead.removeAttribute("src");
      lead.load();
      URL.revokeObjectURL(url);
    },
  };
}

async function loadAnimated(file: File): Promise<FrameSampler> {
  if (typeof ImageDecoder === "undefined") {
    throw new Error("ImageDecoder is unavailable");
  }
  const data = await file.arrayBuffer();
  const decoder = new ImageDecoder({ data, type: file.type });
  await decoder.tracks.ready;
  const track = decoder.tracks.selectedTrack;
  const frameCount = track?.frameCount ?? 1;

  const native: { frame: VideoFrame; start: number }[] = [];
  let cursor = 0;
  let width = 0;
  let height = 0;
  for (let i = 0; i < frameCount; i++) {
    const { image } = await decoder.decode({ frameIndex: i });
    width = image.displayWidth;
    height = image.displayHeight;
    native.push({ frame: image, start: cursor });
    cursor += (image.duration ?? 100_000) / 1000;
  }
  const durationMs = cursor;

  return {
    kind: "animated",
    width,
    height,
    durationMs,
    nativeFrameCount: frameCount,
    frameRate: durationMs > 0 ? frameCount / (durationMs / 1000) : 0,
    async sampleByCount(n, opts) {
      const resize = resizeOptions(width, height, opts?.maxDecodeSize);
      const [a, b] = resolveRange(opts?.range);
      const out: ImageBitmap[] = [];
      for (let i = 0; i < n; i++) {
        const t = (a + ((i + 0.5) / n) * (b - a)) * durationMs;
        out.push(await createImageBitmap(native[frameAt(native, t)].frame, resize));
        opts?.onProgress?.((i + 1) / n);
      }
      return out;
    },
    async sampleAtTimes(times, opts) {
      const resize = resizeOptions(width, height, opts?.maxDecodeSize);
      const out: ImageBitmap[] = [];
      for (let i = 0; i < times.length; i++) {
        out.push(await createImageBitmap(native[frameAt(native, times[i] * 1000)].frame, resize));
        opts?.onProgress?.((i + 1) / times.length);
      }
      return out;
    },
    dispose() {
      for (const f of native) f.frame.close();
      decoder.close();
    },
  };
}

function frameAt(native: { start: number }[], tMs: number): number {
  let idx = 0;
  for (let j = 0; j < native.length; j++) {
    if (native[j].start <= tMs) idx = j;
    else break;
  }
  return idx;
}

async function loadImage(file: File): Promise<FrameSampler> {
  const source = await loadImageBitmap(file);
  return {
    kind: "image",
    width: source.width,
    height: source.height,
    durationMs: 0,
    nativeFrameCount: 1,
    frameRate: 0,
    async sampleByCount(n, opts) {
      const resize = resizeOptions(source.width, source.height, opts?.maxDecodeSize);
      const frame = resize ? await createImageBitmap(source, resize) : source;
      return Array.from({ length: n }, () => frame);
    },
    async sampleAtTimes(times, opts) {
      const resize = resizeOptions(source.width, source.height, opts?.maxDecodeSize);
      const frame = resize ? await createImageBitmap(source, resize) : source;
      return times.map(() => frame);
    },
    dispose() {
      source.close();
    },
  };
}
