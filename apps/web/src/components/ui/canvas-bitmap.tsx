"use client"

import { useEffect, useRef } from "react"

import { safeDrawImage } from "~/lib/sl/image"

export function CanvasBitmap({
  bitmap,
  className,
}: {
  bitmap: ImageBitmap | null
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !bitmap || bitmap.width === 0) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    safeDrawImage(ctx, bitmap, 0, 0)
  }, [bitmap])
  if (!bitmap) return null
  return <canvas ref={ref} className={className} />
}

export function ScaledCanvasBitmap({
  bitmap,
  size,
  className,
}: {
  bitmap: ImageBitmap
  size: number
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || bitmap.width === 0) return
    const scale = Math.min(size / bitmap.width, size / bitmap.height)
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (ctx) safeDrawImage(ctx, bitmap, 0, 0, w, h)
  }, [bitmap, size])
  return <canvas ref={ref} className={className} />
}
