const TGA_EXT = /\.tga$/i;
const TGA_TYPES = [
  "image/tga",
  "image/x-tga",
  "image/targa",
  "image/x-targa",
  "application/tga",
  "application/x-tga",
];

export function isTga(file: File) {
  return TGA_TYPES.includes(file.type) || TGA_EXT.test(file.name);
}

type DrawArgs =
  | [dx: number, dy: number]
  | [dx: number, dy: number, dw: number, dh: number]
  | [
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ];

// drawImage on a closed ImageBitmap throws InvalidStateError; close() zeroes its
// dimensions. Returns false when the source is closed so callers can stop drawing.
export function safeDrawImage(
  ctx: CanvasRenderingContext2D,
  source: ImageBitmap,
  ...args: DrawArgs
): boolean {
  if (source.width === 0 || source.height === 0) return false;
  try {
    (ctx.drawImage as (img: ImageBitmap, ...a: number[]) => void)(source, ...args);
    return true;
  } catch {
    return false;
  }
}

/** Downscale a frame to a tiny RGBA buffer for cheap similarity comparison. */
let scratchCanvas: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;

export function downscaleData(bitmap: ImageBitmap, size = 32): Uint8ClampedArray {
  if (!scratchCanvas) {
    scratchCanvas = document.createElement("canvas");
    scratchCtx = scratchCanvas.getContext("2d", { willReadFrequently: true });
  }
  const ctx = scratchCtx!;
  if (scratchCanvas.width !== size || scratchCanvas.height !== size) {
    scratchCanvas.width = size;
    scratchCanvas.height = size;
  } else {
    ctx.clearRect(0, 0, size, size);
  }
  ctx.drawImage(bitmap, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

export function bitmapToPngDataUrl(bitmap: ImageBitmap): string {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  return canvas.toDataURL("image/png");
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function loadImageBitmap(file: File) {
  if (isTga(file)) {
    const data = decodeTga(await file.arrayBuffer());
    return createImageBitmap(data);
  }
  return createImageBitmap(file);
}

export function decodeTga(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const idLength = bytes[0];
  const imageType = bytes[2];
  const width = view.getUint16(12, true);
  const height = view.getUint16(14, true);
  const pixelDepth = bytes[16];
  const descriptor = bytes[17];
  const topOrigin = (descriptor & 0x20) !== 0;

  if (width <= 0 || height <= 0) {
    throw new Error("Invalid TGA dimensions");
  }
  const bytesPerPixel = pixelDepth >> 3;
  const isRle = imageType === 10 || imageType === 11;
  const isGray = imageType === 3 || imageType === 11;
  if (![2, 3, 10, 11].includes(imageType)) {
    throw new Error("Unsupported TGA image type");
  }

  let offset = 18 + idLength;
  const out = new Uint8ClampedArray(width * height * 4);
  const total = width * height;

  const putPixel = (i: number, src: Uint8Array, p: number) => {
    const o = i * 4;
    if (isGray) {
      out[o] = out[o + 1] = out[o + 2] = src[p];
      out[o + 3] = 255;
    } else {
      // TGA true-colour is stored BGRA.
      out[o] = src[p + 2];
      out[o + 1] = src[p + 1];
      out[o + 2] = src[p];
      out[o + 3] = bytesPerPixel === 4 ? src[p + 3] : 255;
    }
  };

  if (!isRle) {
    for (let i = 0; i < total; i++) {
      putPixel(i, bytes, offset);
      offset += bytesPerPixel;
    }
  } else {
    let i = 0;
    while (i < total && offset < bytes.length) {
      const packet = bytes[offset++];
      const count = (packet & 0x7f) + 1;
      if (packet & 0x80) {
        for (let c = 0; c < count && i < total; c++) putPixel(i++, bytes, offset);
        offset += bytesPerPixel;
      } else {
        for (let c = 0; c < count && i < total; c++) {
          putPixel(i++, bytes, offset);
          offset += bytesPerPixel;
        }
      }
    }
  }

  // TGA defaults to a bottom-left origin; flip to top-left for ImageData.
  if (!topOrigin) {
    const row = width * 4;
    const tmp = new Uint8ClampedArray(row);
    for (let y = 0; y < height >> 1; y++) {
      const top = y * row;
      const bottom = (height - 1 - y) * row;
      tmp.set(out.subarray(top, top + row));
      out.copyWithin(top, bottom, bottom + row);
      out.set(tmp, bottom);
    }
  }

  return new ImageData(out, width, height);
}
