import { fitRect } from "./grid";

export type FitMode = "cover" | "contain" | "stretch";

export interface OverlayOptions {
  bitmap: ImageBitmap;
  opacity: number;
  blend: GlobalCompositeOperation;
  fit: FitMode;
  perCell: boolean;
}

export interface ComposeOptions {
  frames: ImageBitmap[];
  cols: number;
  rows: number;
  sheetWidth: number;
  sheetHeight: number;
  fit: FitMode;
  background: string;
  overlay?: OverlayOptions | null;
}

function drawFitted(
  ctx: CanvasRenderingContext2D,
  img: ImageBitmap,
  x: number,
  y: number,
  w: number,
  h: number,
  fit: FitMode,
) {
  const { dx, dy, dw, dh } = fitRect(img.width, img.height, w, h, fit);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + dx, y + dy, dw, dh);
  ctx.restore();
}

export function composeSheet(options: ComposeOptions) {
  const { frames, cols, rows, sheetWidth, sheetHeight, fit, background, overlay } = options;

  const cellW = sheetWidth / cols;
  const cellH = sheetHeight / rows;
  const canvas = document.createElement("canvas");
  canvas.width = sheetWidth;
  canvas.height = sheetHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.imageSmoothingQuality = "high";

  if (background && background !== "transparent") {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, sheetWidth, sheetHeight);
  }

  const count = Math.min(frames.length, cols * rows);
  for (let i = 0; i < count; i++) {
    const cx = (i % cols) * cellW;
    const cy = Math.floor(i / cols) * cellH;
    drawFitted(ctx, frames[i], cx, cy, cellW, cellH, fit);

    if (overlay && overlay.perCell) {
      drawOverlay(ctx, overlay, cx, cy, cellW, cellH);
    }
  }

  if (overlay && !overlay.perCell) {
    drawOverlay(ctx, overlay, 0, 0, sheetWidth, sheetHeight);
  }

  return canvas;
}

function drawOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: OverlayOptions,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const { dx, dy, dw, dh } = fitRect(
    overlay.bitmap.width,
    overlay.bitmap.height,
    w,
    h,
    overlay.fit,
  );
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.globalAlpha = overlay.opacity;
  ctx.globalCompositeOperation = overlay.blend;
  ctx.drawImage(overlay.bitmap, x + dx, y + dy, dw, dh);
  ctx.restore();
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png"): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to encode texture"))),
      type,
    );
  });
}
