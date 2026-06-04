export const POW2_SIZES = [8, 16, 32, 64, 128, 256, 512, 1024, 2048] as const;

export const MAX_TEXTURE_SIZE = 2048;

export function nearestPow2(value: number, max = MAX_TEXTURE_SIZE) {
  let best: number = POW2_SIZES[0];
  for (const size of POW2_SIZES) {
    if (size > max) break;
    best = size;
    if (size >= value) return size;
  }
  return best;
}

export function autoGrid(n: number) {
  const count = Math.max(1, Math.floor(n));
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

export interface SheetDimensions {
  sheetWidth: number;
  sheetHeight: number;
  cellWidth: number;
  cellHeight: number;
  cellAspect: number;
}

export function chooseSheet(
  cols: number,
  rows: number,
  targetAspect: number,
  maxSize: number,
  pow2: boolean,
) {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  const aspect = targetAspect > 0 ? targetAspect : 1;

  if (!pow2) {
    let cellWidth = maxSize / c;
    let cellHeight = cellWidth / aspect;
    if (cellHeight * r > maxSize) {
      cellHeight = maxSize / r;
      cellWidth = cellHeight * aspect;
    }
    const sheetWidth = Math.max(1, Math.round(cellWidth * c));
    const sheetHeight = Math.max(1, Math.round(cellHeight * r));
    return {
      sheetWidth,
      sheetHeight,
      cellWidth: sheetWidth / c,
      cellHeight: sheetHeight / r,
      cellAspect: sheetWidth / c / (sheetHeight / r),
    };
  }

  const candidates = POW2_SIZES.filter((s) => s <= maxSize);
  let best: { w: number; h: number; err: number; area: number } | null = null;
  for (const w of candidates) {
    for (const h of candidates) {
      const cellAspect = w / c / (h / r);
      const err = Math.abs(Math.log(cellAspect / aspect));
      const area = w * h;
      if (
        best === null ||
        err < best.err - 0.04 ||
        (Math.abs(err - best.err) <= 0.04 && area > best.area)
      ) {
        best = { w, h, err, area };
      }
    }
  }
  const chosen = best ?? { w: maxSize, h: maxSize };
  return {
    sheetWidth: chosen.w,
    sheetHeight: chosen.h,
    cellWidth: chosen.w / c,
    cellHeight: chosen.h / r,
    cellAspect: chosen.w / c / (chosen.h / r),
  };
}

export function fitRect(
  iw: number,
  ih: number,
  w: number,
  h: number,
  mode: "cover" | "contain" | "stretch",
) {
  if (mode === "stretch" || iw <= 0 || ih <= 0) {
    return { dx: 0, dy: 0, dw: w, dh: h };
  }
  const scale = mode === "cover" ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  return { dx: (w - dw) / 2, dy: (h - dh) / 2, dw, dh };
}
