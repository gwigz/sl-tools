// Skip bitmaps still referenced by `keep`; the image sampler reuses one across frames.
export function closeFrames(toClose: ImageBitmap[], keep?: Set<ImageBitmap>) {
  const closed = new Set<ImageBitmap>()

  for (const bitmap of toClose) {
    if (keep?.has(bitmap) || closed.has(bitmap)) {
      continue
    }

    closed.add(bitmap)
    bitmap.close()
  }
}

export function rangeFromTrim(trim: [number, number], duration: number) {
  if (duration <= 0) {
    return { start: 0, end: 1 }
  }

  return { start: trim[0] / duration, end: trim[1] / duration }
}
