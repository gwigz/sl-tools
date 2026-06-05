const TGA_EXT = /\.tga$/i
const TGA_TYPES = [
  "image/tga",
  "image/x-tga",
  "image/targa",
  "image/x-targa",
  "application/tga",
  "application/x-tga",
]

export function isTga(file: File) {
  return TGA_TYPES.includes(file.type) || TGA_EXT.test(file.name)
}

type DrawArgs =
  | [dx: number, dy: number]
  | [dx: number, dy: number, dw: number, dh: number]
  | [sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number]

// drawImage on a closed ImageBitmap throws InvalidStateError; close() zeroes its
// dimensions. Returns false when the source is closed so callers can stop drawing.
export function safeDrawImage(
  ctx: CanvasRenderingContext2D,
  source: ImageBitmap,
  ...args: DrawArgs
): boolean {
  if (source.width === 0 || source.height === 0) {
    return false
  }

  try {
    ;(ctx.drawImage as (img: ImageBitmap, ...rest: number[]) => void)(source, ...args)

    return true
  } catch {
    return false
  }
}

/** Downscale a frame to a tiny RGBA buffer for cheap similarity comparison. */
let scratchCanvas: HTMLCanvasElement | null = null
let scratchCtx: CanvasRenderingContext2D | null = null

export function downscaleData(bitmap: ImageBitmap, size = 32): Uint8ClampedArray {
  if (!scratchCanvas) {
    scratchCanvas = document.createElement("canvas")
    scratchCtx = scratchCanvas.getContext("2d", { willReadFrequently: true })
  }

  const ctx = scratchCtx!

  if (scratchCanvas.width !== size || scratchCanvas.height !== size) {
    scratchCanvas.width = size
    scratchCanvas.height = size
  } else {
    ctx.clearRect(0, 0, size, size)
  }

  ctx.drawImage(bitmap, 0, 0, size, size)

  return ctx.getImageData(0, 0, size, size).data
}

export function bitmapToPngDataUrl(bitmap: ImageBitmap): string {
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0)

  return canvas.toDataURL("image/png")
}

export function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export async function loadImageBitmap(file: File) {
  if (isTga(file)) {
    const data = decodeTga(await file.arrayBuffer())

    return createImageBitmap(data)
  }

  return createImageBitmap(file)
}

export function decodeTga(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)

  const idLength = bytes[0]
  const imageType = bytes[2]
  const width = view.getUint16(12, true)
  const height = view.getUint16(14, true)
  const pixelDepth = bytes[16]
  const descriptor = bytes[17]
  const topOrigin = (descriptor & 0x20) !== 0

  if (width <= 0 || height <= 0) {
    throw new Error("Invalid TGA dimensions")
  }

  const bytesPerPixel = pixelDepth >> 3
  const isRle = imageType === 10 || imageType === 11
  const isGray = imageType === 3 || imageType === 11

  if (![2, 3, 10, 11].includes(imageType)) {
    throw new Error("Unsupported TGA image type")
  }

  let offset = 18 + idLength
  const out = new Uint8ClampedArray(width * height * 4)
  const total = width * height

  const putPixel = (pixel: number, src: Uint8Array, sourceOffset: number) => {
    const outOffset = pixel * 4

    if (isGray) {
      out[outOffset] = out[outOffset + 1] = out[outOffset + 2] = src[sourceOffset]
      out[outOffset + 3] = 255
    } else {
      // TGA true-colour is stored BGRA.
      out[outOffset] = src[sourceOffset + 2]
      out[outOffset + 1] = src[sourceOffset + 1]
      out[outOffset + 2] = src[sourceOffset]
      out[outOffset + 3] = bytesPerPixel === 4 ? src[sourceOffset + 3] : 255
    }
  }

  if (!isRle) {
    for (let index = 0; index < total; index++) {
      putPixel(index, bytes, offset)
      offset += bytesPerPixel
    }
  } else {
    let index = 0

    while (index < total && offset < bytes.length) {
      const packet = bytes[offset++]
      const count = (packet & 0x7f) + 1

      if (packet & 0x80) {
        for (let repeat = 0; repeat < count && index < total; repeat++) {
          putPixel(index++, bytes, offset)
        }

        offset += bytesPerPixel
      } else {
        for (let repeat = 0; repeat < count && index < total; repeat++) {
          putPixel(index++, bytes, offset)
          offset += bytesPerPixel
        }
      }
    }
  }

  // TGA defaults to a bottom-left origin; flip to top-left for ImageData.
  if (!topOrigin) {
    const rowBytes = width * 4
    const scratch = new Uint8ClampedArray(rowBytes)

    for (let rowIndex = 0; rowIndex < height >> 1; rowIndex++) {
      const topOffset = rowIndex * rowBytes
      const bottomOffset = (height - 1 - rowIndex) * rowBytes

      scratch.set(out.subarray(topOffset, topOffset + rowBytes))
      out.copyWithin(topOffset, bottomOffset, bottomOffset + rowBytes)
      out.set(scratch, bottomOffset)
    }
  }

  return new ImageData(out, width, height)
}
