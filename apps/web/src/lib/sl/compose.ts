import { fitRect } from "./grid"
import { safeDrawImage } from "./image"

export type FitMode = "cover" | "contain" | "stretch"

export interface OverlayOptions {
  bitmap: ImageBitmap
  opacity: number
  blend: GlobalCompositeOperation
  fit: FitMode
  perCell: boolean
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
  overlay?: OverlayOptions | null
}

// Fit `img` so that it looks correct AFTER Second Life stretches the cell to the
// face aspect. We fit into a normalized face box, then map that placement into
// the (possibly differently-proportioned) cell, pre-distorting so SL's cell-to-face
// stretch reproduces the intended fit at the right aspect.
function drawFaceFitted(
  ctx: CanvasRenderingContext2D,
  img: ImageBitmap,
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

export function composeSheet(options: ComposeOptions) {
  const { frames, cols, rows, sheetWidth, sheetHeight, fit, faceAspect, background, overlay } =
    options

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

  for (let index = 0; index < count; index++) {
    const cellX = (index % cols) * cellW
    const cellY = Math.floor(index / cols) * cellH

    drawFaceFitted(ctx, frames[index], cellX, cellY, cellW, cellH, fit, faceAspect)

    if (overlay && overlay.perCell) {
      ctx.save()
      ctx.globalAlpha = overlay.opacity
      ctx.globalCompositeOperation = overlay.blend
      drawFaceFitted(ctx, overlay.bitmap, cellX, cellY, cellW, cellH, overlay.fit, faceAspect)
      ctx.restore()
    }
  }

  if (overlay && !overlay.perCell && overlay.bitmap.width > 0) {
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
