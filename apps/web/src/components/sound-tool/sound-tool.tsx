"use client"

import {
  AudioLines,
  AudioWaveform,
  Binary,
  Clock,
  Download,
  LoaderCircle,
  MoveRight,
  Pause,
  Play,
  ScrollText,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Dropzone } from "~/components/texture-tool/dropzone"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { CardDivider, NumberField, SwitchRow } from "~/components/ui/field"
import { Input } from "~/components/ui/input"
import { Label } from "~/components/ui/label"
import { cn } from "~/lib/utils"
import {
  applyGain,
  buildZip,
  type ChunkRange,
  buildClipName,
  DEFAULT_CLIP_TEMPLATE,
  dbToGain,
  type DecodedTrack,
  decodeTrack,
  encodeWavMono16,
  gainToDb,
  NORMALIZE_TARGET_DB,
  peakOf,
  RECOMMENDED_CHUNK_SECONDS,
  sanitizeBaseName,
  SL_SAMPLE_RATE,
  splitChunks,
  UPLOAD_COST_PER_CLIP,
} from "~/lib/audio/split"

function formatSeconds(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60)
    const rest = seconds - minutes * 60

    return `${minutes}m ${rest.toFixed(1)}s`
  }

  return `${seconds.toFixed(1)}s`
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")

  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function WaveformEditor({
  track,
  gain,
  cropStart,
  cropEnd,
  chunks,
  playingRegion,
  playheadFraction,
  onCropChange,
}: {
  track: DecodedTrack
  gain: number
  cropStart: number
  cropEnd: number
  chunks: ChunkRange[]
  playingRegion: { start: number; end: number } | null
  playheadFraction: () => number | null
  onCropChange: (start: number, end: number) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playheadRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<"start" | "end" | null>(null)

  const duration = track.duration
  const startFraction = cropStart / duration
  const endFraction = cropEnd / duration
  const cropStartSample = Math.round(cropStart * SL_SAMPLE_RATE)

  useEffect(() => {
    const playhead = playheadRef.current

    if (!playhead) {
      return
    }

    if (!playingRegion) {
      playhead.style.display = "none"
      return
    }

    let frame = 0

    const tick = () => {
      const fraction = playheadFraction()

      if (fraction === null) {
        playhead.style.display = "none"
      } else {
        playhead.style.display = "block"
        playhead.style.left = `${fraction * 100}%`
      }

      frame = requestAnimationFrame(tick)
    }

    tick()

    return () => cancelAnimationFrame(frame)
  }, [playingRegion, playheadFraction])

  useEffect(() => {
    const canvas = canvasRef.current

    if (!canvas) {
      return
    }

    const width = canvas.clientWidth
    const height = canvas.clientHeight
    const scale = Math.min(window.devicePixelRatio, 2)

    canvas.width = width * scale
    canvas.height = height * scale

    const context = canvas.getContext("2d")

    if (!context) {
      return
    }

    context.scale(scale, scale)
    context.clearRect(0, 0, width, height)

    const { samples } = track
    const mid = height / 2
    const step = samples.length / width

    for (let x = 0; x < width; x++) {
      let min = 1
      let max = -1

      const from = Math.floor(x * step)
      const to = Math.min(Math.floor((x + 1) * step) + 1, samples.length)
      const stride = Math.max(1, Math.floor((to - from) / 64))

      for (let index = from; index < to; index += stride) {
        const value = samples[index]

        if (value < min) {
          min = value
        }

        if (value > max) {
          max = value
        }
      }

      const clipped = max * gain > 1 || min * gain < -1

      min = Math.max(-1, min * gain)
      max = Math.min(1, max * gain)

      const top = mid - max * mid
      const bottom = mid - min * mid

      context.fillStyle = clipped ? "rgba(248, 113, 113, 0.9)" : "rgba(160, 160, 165, 0.85)"
      context.fillRect(x, top, 1, Math.max(1, bottom - top))
    }

    context.fillStyle = "rgba(251, 191, 36, 0.55)"

    for (const chunk of chunks.slice(1)) {
      context.fillRect(((cropStartSample + chunk.start) / samples.length) * width, 0, 1, height)
    }
  }, [track, gain, chunks, cropStartSample])

  const fractionFromEvent = (event: React.PointerEvent) => {
    const container = containerRef.current

    if (!container) {
      return 0
    }

    const rect = container.getBoundingClientRect()

    return Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1)
  }

  const moveHandle = (event: React.PointerEvent) => {
    if (!dragRef.current) {
      return
    }

    const seconds = fractionFromEvent(event) * duration

    if (dragRef.current === "start") {
      onCropChange(Math.min(seconds, cropEnd - 1), cropEnd)
    } else {
      onCropChange(cropStart, Math.max(seconds, cropStart + 1))
    }
  }

  const handle = (side: "start" | "end", fraction: number) => (
    <div
      role="slider"
      aria-label={side === "start" ? "Crop start" : "Crop end"}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={side === "start" ? cropStart : cropEnd}
      tabIndex={0}
      className={cn(
        "absolute top-0 h-full w-2 -translate-x-1/2 cursor-ew-resize touch-none",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded after:bg-foreground/60",
        "hover:after:bg-foreground",
      )}
      style={{ left: `${fraction * 100}%` }}
      onPointerDown={(event) => {
        dragRef.current = side
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={moveHandle}
      onPointerUp={() => {
        dragRef.current = null
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 1 : 0.1
        let delta = 0

        if (event.key === "ArrowLeft") {
          delta = -step
        } else if (event.key === "ArrowRight") {
          delta = step
        } else {
          return
        }

        event.preventDefault()

        if (side === "start") {
          onCropChange(Math.min(Math.max(cropStart + delta, 0), cropEnd - 1), cropEnd)
        } else {
          onCropChange(cropStart, Math.max(Math.min(cropEnd + delta, duration), cropStart + 1))
        }
      }}
    />
  )

  return (
    <div ref={containerRef} className="relative select-none">
      <canvas ref={canvasRef} className="h-20 w-full rounded-md border bg-muted/30" />
      {playingRegion && (
        <div
          className="pointer-events-none absolute inset-y-0 bg-amber-400/10"
          style={{
            left: `${playingRegion.start * 100}%`,
            width: `${(playingRegion.end - playingRegion.start) * 100}%`,
          }}
        />
      )}
      <div
        ref={playheadRef}
        className="pointer-events-none absolute inset-y-0 w-px bg-amber-400"
        style={{ display: "none" }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 left-0 rounded-l-md bg-background/70"
        style={{ width: `${startFraction * 100}%` }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 rounded-r-md bg-background/70"
        style={{ width: `${(1 - endFraction) * 100}%` }}
      />
      {handle("start", startFraction)}
      {handle("end", endFraction)}
    </div>
  )
}

export function SoundTool() {
  const [track, setTrack] = useState<DecodedTrack | null>(null)
  const [fileName, setFileName] = useState("")
  const [decoding, setDecoding] = useState(false)
  const [chunkSeconds, setChunkSeconds] = useState(RECOMMENDED_CHUNK_SECONDS)
  const [evenSplit, setEvenSplit] = useState(true)
  const [nameTemplate, setNameTemplate] = useState(DEFAULT_CLIP_TEMPLATE)
  const [crop, setCrop] = useState<{ start: number; end: number }>({ start: 0, end: 0 })
  const [normalize, setNormalize] = useState(true)
  const [gainDb, setGainDb] = useState(0)
  const [playing, setPlaying] = useState<number | "all" | null>(null)

  const playbackRef = useRef<{
    context: AudioContext | null
    source: AudioBufferSourceNode | null
    buffer: AudioBuffer | null
    startedAt: number
    rangeStart: number
  }>({ context: null, source: null, buffer: null, startedAt: 0, rangeStart: 0 })

  useEffect(() => {
    const playback = playbackRef.current

    return () => {
      playback.source?.stop()
      playback.context?.close().catch(() => {})
    }
  }, [])

  const cropped = useMemo(() => {
    if (!track) {
      return null
    }

    const start = Math.round(crop.start * SL_SAMPLE_RATE)
    const end = Math.min(Math.round(crop.end * SL_SAMPLE_RATE), track.samples.length)

    return track.samples.subarray(start, end)
  }, [track, crop])

  const sourcePeak = useMemo(() => (cropped ? peakOf(cropped) : 0), [cropped])

  const gain = useMemo(() => {
    let value = dbToGain(gainDb)

    if (normalize && sourcePeak > 0) {
      value *= dbToGain(NORMALIZE_TARGET_DB) / sourcePeak
    }

    return value
  }, [normalize, sourcePeak, gainDb])

  const processed = useMemo(() => {
    if (!cropped) {
      return null
    }

    return gain === 1 ? cropped : applyGain(cropped, gain)
  }, [cropped, gain])

  const outputPeakDb = sourcePeak > 0 ? gainToDb(sourcePeak * gain) : Number.NEGATIVE_INFINITY
  const clipping = outputPeakDb > 0.01

  useEffect(() => {
    playbackRef.current.buffer = null
    stopPlayback()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [processed])

  const chunks = useMemo(
    () => (processed ? splitChunks(processed.length, chunkSeconds, evenSplit) : []),
    [processed, chunkSeconds, evenSplit],
  )

  const baseName = useMemo(() => sanitizeBaseName(fileName), [fileName])
  const chunkLengthSeconds =
    chunks.length > 0 ? (chunks[0].end - chunks[0].start) / SL_SAMPLE_RATE : 0

  /* Player Script card is parked for now; restore with the imports
     (ScriptBlock, Copy icon, buildPlayerScript) when it comes back.

  const [loopTrack, setLoopTrack] = useState(true)
  const script = useMemo(
    () => buildPlayerScript(chunkLengthSeconds, loopTrack),
    [chunkLengthSeconds, loopTrack],
  )

  const copyScript = async () => {
    await navigator.clipboard.writeText(script)
    toast.success("Script copied")
  }
  */

  const selectFile = async (file: File) => {
    stopPlayback()
    setDecoding(true)

    try {
      const decoded = await decodeTrack(file)

      playbackRef.current.buffer = null
      setTrack(decoded)
      setFileName(file.name)
      setCrop({ start: 0, end: decoded.duration })
      setGainDb(0)
    } catch {
      toast.error(`${file.name}: could not decode this file`)
    } finally {
      setDecoding(false)
    }
  }

  const stopPlayback = () => {
    const playback = playbackRef.current

    if (playback.source) {
      playback.source.onended = null
      playback.source.stop()
      playback.source = null
    }

    setPlaying(null)
  }

  const playRange = (id: number | "all", startSample: number, endSample: number) => {
    if (!processed) {
      return
    }

    if (playing === id) {
      stopPlayback()
      return
    }

    const playback = playbackRef.current

    if (!playback.context) {
      playback.context = new AudioContext()
    }

    if (!playback.buffer) {
      playback.buffer = playback.context.createBuffer(1, processed.length, SL_SAMPLE_RATE)
      playback.buffer.copyToChannel(processed, 0)
    }

    stopPlayback()

    const source = playback.context.createBufferSource()

    source.buffer = playback.buffer
    source.connect(playback.context.destination)
    source.onended = () => {
      if (playback.source === source) {
        playback.source = null
        setPlaying(null)
      }
    }
    source.start(0, startSample / SL_SAMPLE_RATE, (endSample - startSample) / SL_SAMPLE_RATE)
    playback.source = source
    playback.startedAt = playback.context.currentTime
    playback.rangeStart = startSample
    setPlaying(id)
  }

  const playChunk = (index: number) => {
    playRange(index, chunks[index].start, chunks[index].end)
  }

  const playSelection = () => {
    if (processed) {
      playRange("all", 0, processed.length)
    }
  }

  const downloadChunk = (index: number) => {
    if (!processed) {
      return
    }

    const chunk = chunks[index]
    const wav = encodeWavMono16(processed.subarray(chunk.start, chunk.end))

    downloadBlob(
      new Blob([wav], { type: "audio/wav" }),
      buildClipName(nameTemplate, baseName, index, chunks.length),
    )
  }

  const downloadZip = () => {
    if (!processed) {
      return
    }

    const files = chunks.map((chunk, index) => ({
      name: buildClipName(nameTemplate, baseName, index, chunks.length),
      data: encodeWavMono16(processed.subarray(chunk.start, chunk.end)),
    }))

    downloadBlob(buildZip(files), `${baseName}-clips.zip`)
  }

  const cropActive = track !== null && (crop.start > 0 || crop.end < track.duration)

  const playingRegion = useMemo(() => {
    if (playing === null || !track || !processed) {
      return null
    }

    const range = playing === "all" ? { start: 0, end: processed.length } : chunks[playing]

    if (!range) {
      return null
    }

    const cropStartSample = Math.round(crop.start * SL_SAMPLE_RATE)

    return {
      start: (cropStartSample + range.start) / track.samples.length,
      end: (cropStartSample + range.end) / track.samples.length,
    }
  }, [playing, chunks, crop.start, track, processed])

  const playheadFraction = useCallback(() => {
    const playback = playbackRef.current

    if (!playback.context || !playback.source || !track) {
      return null
    }

    const seconds =
      crop.start +
      playback.rangeStart / SL_SAMPLE_RATE +
      (playback.context.currentTime - playback.startedAt)

    return Math.min(seconds / track.duration, 1)
  }, [crop.start, track])

  return (
    <div className="flex flex-col gap-4">
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AudioLines className="size-4" />
            <span>Source</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Dropzone
            onSelect={selectFile}
            accept="audio/*,video/*,.wav,.mp3,.ogg,.m4a,.flac,.aac,.opus,.mp4,.webm,.mov"
            compact={!!track}
            label={track ? fileName : "Drop any audio or video file"}
          />
          {decoding && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" /> Decoding…
            </p>
          )}
          {track && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Badge variant="secondary">
                <Clock className="size-3" /> {formatSeconds(track.sourceDuration)}
              </Badge>
              <Badge variant="outline">
                {track.sourceChannels === 1 ? (
                  "Mono"
                ) : (
                  <>
                    {track.sourceChannels}ch <MoveRight className="size-3" /> Mono
                  </>
                )}
              </Badge>
              <Badge variant="outline">
                <AudioWaveform className="size-3" /> 44.1kHz
              </Badge>
              <Badge variant="outline">
                <Binary className="size-3" /> 16-bit PCM
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {track && processed && chunks.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScrollText className="size-4" />
              <span>Clips</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <WaveformEditor
              track={track}
              gain={gain}
              cropStart={crop.start}
              cropEnd={crop.end}
              chunks={chunks}
              playingRegion={playingRegion}
              playheadFraction={playheadFraction}
              onCropChange={(start, end) => setCrop({ start, end })}
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 shrink-0"
                  aria-label={playing === "all" ? "Stop" : "Play selection"}
                  onClick={playSelection}
                >
                  {playing === "all" ? <Pause className="size-3" /> : <Play className="size-3" />}
                </Button>
                <span>
                  {cropActive
                    ? `${formatSeconds(crop.start)} – ${formatSeconds(crop.end)} (${formatSeconds(crop.end - crop.start)})`
                    : "Drag the edge handles to crop"}
                </span>
              </span>
              {cropActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => setCrop({ start: 0, end: track.duration })}
                >
                  Reset Crop
                </Button>
              )}
            </div>
            <CardDivider />
            <div className="grid gap-3 sm:grid-cols-2">
              <SwitchRow
                label="Normalize"
                hint={`Boosts the loudest peak to ${NORMALIZE_TARGET_DB} dBFS. In-world playback can only turn sounds down, so upload at full level`}
                checked={normalize}
                onChange={setNormalize}
              />
              <NumberField
                label="Extra Gain (dB)"
                value={gainDb}
                min={-12}
                max={12}
                step={0.5}
                onChange={(value) => setGainDb(Math.min(Math.max(value, -12), 12))}
              />
            </div>
            <p className={cn("text-xs", clipping ? "text-red-400" : "text-muted-foreground")}>
              {Number.isFinite(outputPeakDb)
                ? clipping
                  ? `Peak ${outputPeakDb.toFixed(1)} dBFS, clipping! Lower the gain.`
                  : `Peak ${outputPeakDb.toFixed(1)} dBFS`
                : "Silent selection"}
            </p>
            <CardDivider />
            <div className="grid gap-3 sm:grid-cols-2">
              <SwitchRow
                label="Even Lengths"
                hint="Keeps every clip the same length so queued playback stays in step"
                checked={evenSplit}
                onChange={setEvenSplit}
              />
              <NumberField
                label="Max Clip Length (s)"
                value={chunkSeconds}
                min={1}
                max={RECOMMENDED_CHUNK_SECONDS}
                step={0.1}
                onChange={(value) =>
                  setChunkSeconds(Math.min(Math.max(value, 1), RECOMMENDED_CHUNK_SECONDS))
                }
              />
            </div>
            <CardDivider />
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs">Clip Name</Label>
              <Input
                value={nameTemplate}
                placeholder={DEFAULT_CLIP_TEMPLATE}
                onChange={(event) => setNameTemplate(event.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                {"{name}"} is the file name, {"{n}"} the clip number. Names are capped at 63
                characters, Second Life's inventory limit.
              </p>
            </div>
            <CardDivider />
            <p className="text-xs text-muted-foreground">
              {chunks.length} clips · {formatSeconds(chunkLengthSeconds)} each · L$
              {chunks.length * UPLOAD_COST_PER_CLIP} to upload
            </p>
            <ul className="flex flex-col gap-1">
              {chunks.map((chunk, index) => (
                <li
                  key={chunk.start}
                  className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0"
                      aria-label={playing === index ? "Stop" : "Play"}
                      onClick={() => playChunk(index)}
                    >
                      {playing === index ? (
                        <Pause className="size-3" />
                      ) : (
                        <Play className="size-3" />
                      )}
                    </Button>
                    <span className="truncate font-mono">
                      {buildClipName(nameTemplate, baseName, index, chunks.length)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-muted-foreground tabular-nums">
                      {formatSeconds((chunk.end - chunk.start) / SL_SAMPLE_RATE)}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label="Download clip"
                      onClick={() => downloadChunk(index)}
                    >
                      <Download className="size-3" />
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
            <Button onClick={downloadZip}>
              <Download className="size-4" /> Download All (.zip)
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Upload each clip in-world via Build &gt; Upload &gt; Sound (L$
              {UPLOAD_COST_PER_CLIP} each, free on Premium Plus). Keep the numbered names so they
              play in order.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Player Script card, parked for now
      {track && chunks.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="size-4" />
              <span>Player Script</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <SwitchRow label="Loop Track" checked={loopTrack} onChange={setLoopTrack} />
            <ScriptBlock code={script} />
            <Button onClick={copyScript}>
              <Copy className="size-4" /> Copy Script
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Drop the script and all clips into one prim. llSetSoundQueueing keeps the next clip
              queued while the current one plays, and llPreloadSound caches it on nearby viewers,
              which is as close to gapless as Second Life gets.
            </p>
          </CardContent>
        </Card>
      )}
      */}
    </div>
  )
}
