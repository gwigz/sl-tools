import { fitRect } from "./grid"
import { type DrawableSource, safeDrawImage } from "./image"

export type FitMode = "cover" | "contain" | "stretch"

export type MaskSource = "alpha" | "color"

export type BackgroundMode = "transparent" | "color" | "image"

export interface OverlayOptions {
  bitmap: ImageBitmap
  opacity: number
  blend: GlobalCompositeOperation
  fit: FitMode
  perCell: boolean
}

export interface MaskOptions {
  bitmap: ImageBitmap
  source: MaskSource
  invert: boolean
  fit: FitMode
  perCell: boolean
  cutOverlay: boolean
}

export interface ComposeOptions {
  frames: ImageBitmap[]
  cols: number
  rows: number
  sheetWidth: number
  sheetHeight: number
  fit: FitMode
  /** The in-world face aspect (width / height) the cell is stretched to. */
  faceAspect: number
  background: string
  backgroundImage?: OverlayOptions | null
  overlay?: OverlayOptions | null
  mask?: MaskOptions | null
}

// Fit `img` so that it looks correct AFTER Second Life stretches the cell to the
// face aspect. We fit into a normalized face box, then map that placement into
// the (possibly differently-proportioned) cell, pre-distorting so SL's cell-to-face
// stretch reproduces the intended fit at the right aspect.
function drawFaceFitted(
  ctx: CanvasRenderingContext2D,
  img: DrawableSource,
  cellX: number,
  cellY: number,
  cellW: number,
  cellH: number,
  fit: FitMode,
  faceAspect: number,
) {
  if (img.width === 0 || img.height === 0) {
    return
  }

  const faceW = faceAspect > 0 ? faceAspect : 1
  const { dx, dy, dw, dh } = fitRect(img.width, img.height, faceW, 1, fit)
  const scaleX = cellW / faceW
  const scaleY = cellH

  ctx.save()
  ctx.beginPath()
  ctx.rect(cellX, cellY, cellW, cellH)
  ctx.clip()
  safeDrawImage(ctx, img, cellX + dx * scaleX, cellY + dy * scaleY, dw * scaleX, dh * scaleY)
  ctx.restore()
}

function drawFrames(
  ctx: CanvasRenderingContext2D,
  frames: ImageBitmap[],
  cols: number,
  cellW: number,
  cellH: number,
  fit: FitMode,
  faceAspect: number,
  count: number,
) {
  for (let index = 0; index < count; index++) {
    const cellX = (index % cols) * cellW
    const cellY = Math.floor(index / cols) * cellH

    drawFaceFitted(ctx, frames[index], cellX, cellY, cellW, cellH, fit, faceAspect)
  }
}

function drawOverlayLayer(
  ctx: CanvasRenderingContext2D,
  overlay: OverlayOptions,
  cols: number,
  cellW: number,
  cellH: number,
  sheetWidth: number,
  sheetHeight: number,
  faceAspect: number,
  count: number,
) {
  if (overlay.perCell) {
    for (let index = 0; index < count; index++) {
      const cellX = (index % cols) * cellW
      const cellY = Math.floor(index / cols) * cellH

      ctx.save()
      ctx.globalAlpha = overlay.opacity
      ctx.globalCompositeOperation = overlay.blend
      drawFaceFitted(ctx, overlay.bitmap, cellX, cellY, cellW, cellH, overlay.fit, faceAspect)
      ctx.restore()
    }

    return
  }

  if (overlay.bitmap.width === 0) {
    return
  }

  const { dx, dy, dw, dh } = fitRect(
    overlay.bitmap.width,
    overlay.bitmap.height,
    sheetWidth,
    sheetHeight,
    overlay.fit,
  )

  ctx.save()
  ctx.globalAlpha = overlay.opacity
  ctx.globalCompositeOperation = overlay.blend
  safeDrawImage(ctx, overlay.bitmap, dx, dy, dw, dh)
  ctx.restore()
}

// Turn a mask image into a white matte whose alpha is the masking strength: from
// the source alpha channel, or the averaged colour channels, optionally inverted.
// Opaque matte areas keep content under `destination-in`, transparent ones cut it.
function buildMaskMatte(
  bitmap: ImageBitmap,
  source: MaskSource,
  invert: boolean,
): HTMLCanvasElement | null {
  if (bitmap.width === 0 || bitmap.height === 0) {
    return null
  }

  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height

  const ctx = canvas.getContext("2d", { willReadFrequently: true })

  if (!ctx) {
    return null
  }

  ctx.drawImage(bitmap, 0, 0)

  const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  const pixels = image.data

  for (let index = 0; index < pixels.length; index += 4) {
    const value =
      source === "alpha"
        ? pixels[index + 3]
        : (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3

    pixels[index] = 255
    pixels[index + 1] = 255
    pixels[index + 2] = 255
    pixels[index + 3] = invert ? 255 - value : value
  }

  ctx.putImageData(image, 0, 0)

  return canvas
}

// Lay the matte out across the sheet the same way frames are placed, so a single
// `destination-in` pass cuts every cell identically.
function buildSheetMatte(
  matte: HTMLCanvasElement,
  mask: MaskOptions,
  cols: number,
  cellW: number,
  cellH: number,
  sheetWidth: number,
  sheetHeight: number,
  faceAspect: number,
  count: number,
): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas")
  canvas.width = sheetWidth
  canvas.height = sheetHeight

  const ctx = canvas.getContext("2d")

  if (!ctx) {
    return null
  }

  ctx.imageSmoothingQuality = "high"

  if (mask.perCell) {
    for (let index = 0; index < count; index++) {
      const cellX = (index % cols) * cellW
      const cellY = Math.floor(index / cols) * cellH

      drawFaceFitted(ctx, matte, cellX, cellY, cellW, cellH, mask.fit, faceAspect)
    }

    return canvas
  }

  const { dx, dy, dw, dh } = fitRect(matte.width, matte.height, sheetWidth, sheetHeight, mask.fit)

  safeDrawImage(ctx, matte, dx, dy, dw, dh)

  return canvas
}

export function composeSheet(options: ComposeOptions) {
  const {
    frames,
    cols,
    rows,
    sheetWidth,
    sheetHeight,
    fit,
    faceAspect,
    background,
    backgroundImage,
    overlay,
    mask,
  } = options

  const cellW = sheetWidth / cols
  const cellH = sheetHeight / rows
  const canvas = document.createElement("canvas")
  canvas.width = sheetWidth
  canvas.height = sheetHeight

  const ctx = canvas.getContext("2d")

  if (!ctx) {
    return canvas
  }

  ctx.imageSmoothingQuality = "high"

  if (background && background !== "transparent") {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, sheetWidth, sheetHeight)
  }

  const count = Math.min(frames.length, cols * rows)

  if (backgroundImage) {
    drawOverlayLayer(
      ctx,
      backgroundImage,
      cols,
      cellW,
      cellH,
      sheetWidth,
      sheetHeight,
      faceAspect,
      count,
    )
  }

  const matte = mask ? buildMaskMatte(mask.bitmap, mask.source, mask.invert) : null
  const sheetMatte =
    mask && matte
      ? buildSheetMatte(matte, mask, cols, cellW, cellH, sheetWidth, sheetHeight, faceAspect, count)
      : null

  // When masking, frames (and optionally the overlay) are drawn onto a separate
  // layer so `destination-in` cuts only the content, leaving the background intact.
  const layer = sheetMatte ? document.createElement("canvas") : null
  let target = ctx

  if (layer) {
    layer.width = sheetWidth
    layer.height = sheetHeight
    const layerCtx = layer.getContext("2d")

    if (layerCtx) {
      layerCtx.imageSmoothingQuality = "high"
      target = layerCtx
    }
  }

  drawFrames(target, frames, cols, cellW, cellH, fit, faceAspect, count)

  const cutOverlay = !!(overlay && mask?.cutOverlay)

  if (overlay && cutOverlay) {
    drawOverlayLayer(
      target,
      overlay,
      cols,
      cellW,
      cellH,
      sheetWidth,
      sheetHeight,
      faceAspect,
      count,
    )
  }

  if (sheetMatte) {
    target.save()
    target.globalCompositeOperation = "destination-in"
    target.drawImage(sheetMatte, 0, 0)
    target.restore()

    if (layer) {
      ctx.drawImage(layer, 0, 0)
    }
  }

  if (overlay && !cutOverlay) {
    drawOverlayLayer(ctx, overlay, cols, cellW, cellH, sheetWidth, sheetHeight, faceAspect, count)
  }

  return canvas
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png"): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode texture"))),
      type,
    )
  })
}
