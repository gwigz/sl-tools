export const SL_SAMPLE_RATE = 44100

// Uploads must be 1,323,000 samples (30.000s) or less; exactly 30s sometimes
// fails, so 29.9s is the recommended ceiling (wiki.secondlife.com/wiki/Sound_Clips)
export const SL_MAX_SAMPLES = 1_323_000
export const RECOMMENDED_CHUNK_SECONDS = 29.9
export const UPLOAD_COST_PER_CLIP = 10

// In-world playback can only attenuate (volume caps at 1.0), so clips should
// be uploaded at full level: peak-normalized with a little headroom so the
// transcode never pushes past 0 dBFS
export const NORMALIZE_TARGET_DB = -0.5

export function dbToGain(db: number): number {
  return 10 ** (db / 20)
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain)
}

export function peakOf(samples: Float32Array): number {
  let peak = 0

  for (let index = 0; index < samples.length; index++) {
    const value = Math.abs(samples[index])

    if (value > peak) {
      peak = value
    }
  }

  return peak
}

export function applyGain(samples: Float32Array, gain: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(samples.length)

  for (let index = 0; index < samples.length; index++) {
    out[index] = samples[index] * gain
  }

  return out
}

export interface DecodedTrack {
  samples: Float32Array<ArrayBuffer>
  duration: number
  sourceSampleRate: number
  sourceChannels: number
  sourceDuration: number
}

export interface ChunkRange {
  start: number
  end: number
}

// Decode anything the browser can play, then resample to 44.1kHz mono (the
// mixdown SL would otherwise do server-side, with worse results)
export async function decodeTrack(file: File): Promise<DecodedTrack> {
  const arrayBuffer = await file.arrayBuffer()
  const decoder = new AudioContext()

  let decoded: AudioBuffer

  try {
    decoded = await decoder.decodeAudioData(arrayBuffer)
  } finally {
    decoder.close().catch(() => {})
  }

  const length = Math.ceil(decoded.duration * SL_SAMPLE_RATE)
  const offline = new OfflineAudioContext(1, length, SL_SAMPLE_RATE)
  const source = offline.createBufferSource()

  source.buffer = decoded
  source.connect(offline.destination)
  source.start()

  const rendered = await offline.startRendering()
  const samples = new Float32Array(rendered.length)

  rendered.copyFromChannel(samples, 0)

  return {
    samples,
    duration: rendered.length / SL_SAMPLE_RATE,
    sourceSampleRate: decoded.sampleRate,
    sourceChannels: decoded.numberOfChannels,
    sourceDuration: decoded.duration,
  }
}

// Even splitting keeps every clip the same length, which keeps the LSL
// timer-driven queueing in lockstep with playback
export function splitChunks(totalSamples: number, maxSeconds: number, even: boolean): ChunkRange[] {
  const maxSamples = Math.min(Math.floor(maxSeconds * SL_SAMPLE_RATE), SL_MAX_SAMPLES)

  if (totalSamples <= 0 || maxSamples <= 0) {
    return []
  }

  const count = Math.ceil(totalSamples / maxSamples)
  const ranges: ChunkRange[] = []

  if (even) {
    for (let index = 0; index < count; index++) {
      ranges.push({
        start: Math.round((index * totalSamples) / count),
        end: Math.round(((index + 1) * totalSamples) / count),
      })
    }
  } else {
    for (let index = 0; index < count; index++) {
      ranges.push({
        start: index * maxSamples,
        end: Math.min((index + 1) * maxSamples, totalSamples),
      })
    }
  }

  return ranges
}

export function encodeWavMono16(
  samples: Float32Array,
  sampleRate = SL_SAMPLE_RATE,
): Uint8Array<ArrayBuffer> {
  const dataLength = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  const writeString = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }

  writeString(0, "RIFF")
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, "WAVE")
  writeString(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, "data")
  view.setUint32(40, dataLength, true)

  for (let index = 0; index < samples.length; index++) {
    const clamped = Math.max(-1, Math.min(1, samples[index]))

    view.setInt16(44 + index * 2, Math.round(clamped * 32767), true)
  }

  return new Uint8Array(buffer)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)

  for (let n = 0; n < 256; n++) {
    let c = n

    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }

    table[n] = c >>> 0
  }

  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff

  for (let index = 0; index < data.length; index++) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

// Minimal store-only zip, enough for a folder of wav clips
export function buildZip(files: { name: string; data: Uint8Array<ArrayBuffer> }[]): Blob {
  const encoder = new TextEncoder()
  const localParts: Uint8Array<ArrayBuffer>[] = []
  const centralParts: Uint8Array<ArrayBuffer>[] = []

  let offset = 0

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const crc = crc32(file.data)

    const local = new Uint8Array(30 + nameBytes.length)
    const localView = new DataView(local.buffer)

    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint32(14, crc, true)
    localView.setUint32(18, file.data.length, true)
    localView.setUint32(22, file.data.length, true)
    localView.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)

    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint32(16, crc, true)
    centralView.setUint32(20, file.data.length, true)
    centralView.setUint32(24, file.data.length, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)

    localParts.push(local, file.data)
    centralParts.push(central)
    offset += local.length + file.data.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)

  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, files.length, true)
  endView.setUint16(10, files.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" })
}

// Inventory item names cap at 63 characters (wiki.secondlife.com/wiki/Limits);
// the uploader names items after the file (minus extension), so the name is
// truncated in a way that keeps the number suffix intact
export const SL_MAX_NAME_LENGTH = 63

export const DEFAULT_CLIP_TEMPLATE = "{name}-{n}"

// Template tokens: {name} = sanitized source name, {n} = padded clip number.
// A template without {n} gets it appended, since the numbering is what keeps
// inventory order and uniqueness.
export function buildClipName(
  template: string,
  base: string,
  index: number,
  count: number,
): string {
  const width = Math.max(2, String(count).length)
  const number = String(index + 1).padStart(width, "0")

  let pattern = template.trim() || DEFAULT_CLIP_TEMPLATE

  if (!pattern.includes("{n}")) {
    pattern = `${pattern}-{n}`
  }

  const parts = pattern
    .split("{n}")
    .map((part) => part.replaceAll("{name}", base).replace(/[\\/:*?"<>|]/g, "-"))

  const staticLength = parts.reduce((sum, part) => sum + part.length, 0)
  const over = staticLength + number.length * (parts.length - 1) - SL_MAX_NAME_LENGTH

  if (over > 0) {
    const longest = parts.reduce(
      (best, part, partIndex) => (part.length > parts[best].length ? partIndex : best),
      0,
    )

    parts[longest] = parts[longest]
      .slice(0, Math.max(0, parts[longest].length - over))
      .replace(/-+$/, "")
  }

  return `${parts.join(number)}.wav`
}

export function sanitizeBaseName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "")
  const cleaned = stem
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")

  return cleaned.toLowerCase() || "track"
}

// Gapless player: llSetSoundQueueing keeps one clip in reserve while the
// current one plays, the timer tops the queue up once per chunk, and
// llPreloadSound keeps the next clip cached on nearby viewers. llPreloadSound
// forces a 1.0s script sleep per call; the generated script leans on that for
// its startup delay and stays one clip ahead so the sleeps never starve the
// queue (chunks are always well over 2s).
export function buildPlayerScript(chunkSeconds: number, loop: boolean): string {
  return `// Gapless track player
// Drop this script and every clip into one prim.
// Clips play in inventory (alphabetical) order, keep the numbered names.
//
// llPreloadSound pauses this script for 1.0s per call. Playback is not
// affected: the sound queue keeps the handoff seamless while the script
// sleeps, and the timer only needs to queue one clip per chunk.

float VOLUME = 1.0;
integer LOOP_TRACK = ${loop ? "TRUE" : "FALSE"};
float CHUNK_LENGTH = ${chunkSeconds.toFixed(3)};

integer count;
integer next;

queue_next()
{
    llPlaySound(llGetInventoryName(INVENTORY_SOUND, next), VOLUME);
    next = (next + 1) % count;
    llPreloadSound(llGetInventoryName(INVENTORY_SOUND, next)); // sleeps 1.0s
}

default
{
    state_entry()
    {
        count = llGetInventoryNumber(INVENTORY_SOUND);

        if (count == 0)
        {
            llOwnerSay("No sound clips in inventory.");
            return;
        }

        if (count == 1)
        {
            if (LOOP_TRACK) llLoopSound(llGetInventoryName(INVENTORY_SOUND, 0), VOLUME);
            else llPlaySound(llGetInventoryName(INVENTORY_SOUND, 0), VOLUME);
            return;
        }

        llSetSoundQueueing(TRUE);

        // the built-in 1.0s sleep doubles as fetch time for nearby viewers
        llPreloadSound(llGetInventoryName(INVENTORY_SOUND, 0));

        next = 0;
        queue_next(); // start clip 1, preload clip 2 (+1.0s sleep)
        queue_next(); // park clip 2 in the queue, preload clip 3 (+1.0s sleep)

        // those two sleeps mean the first tick lands ~2s into clip 2's
        // playback, right after the queue has opened up again
        llSetTimerEvent(CHUNK_LENGTH);
    }

    timer()
    {
        if (next == 0 && !LOOP_TRACK)
        {
            llSetTimerEvent(0.0);
            return;
        }

        queue_next();
    }

    changed(integer change)
    {
        if (change & CHANGED_INVENTORY) llResetScript();
    }
}
`
}
