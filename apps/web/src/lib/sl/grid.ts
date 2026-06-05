export const POW2_SIZES = [8, 16, 32, 64, 128, 256, 512, 1024, 2048] as const;

export const MAX_TEXTURE_SIZE = 2048;

export function nearestPow2(value: number, max = MAX_TEXTURE_SIZE) {
  let best: number = POW2_SIZES[0];

  for (const size of POW2_SIZES) {
    if (size > max) {
      break;
    }

    best = size;

    if (size >= value) {
      return size;
    }
  }

  return best;
}

export function autoGrid(requested: number) {
  const count = Math.max(1, Math.floor(requested));
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
  const colCount = Math.max(1, Math.floor(cols));
  const rowCount = Math.max(1, Math.floor(rows));
  const aspect = targetAspect > 0 ? targetAspect : 1;

  if (!pow2) {
    let cellWidth = maxSize / colCount;
    let cellHeight = cellWidth / aspect;

    if (cellHeight * rowCount > maxSize) {
      cellHeight = maxSize / rowCount;
      cellWidth = cellHeight * aspect;
    }

    const sheetWidth = Math.max(1, Math.round(cellWidth * colCount));
    const sheetHeight = Math.max(1, Math.round(cellHeight * rowCount));

    return {
      sheetWidth,
      sheetHeight,
      cellWidth: sheetWidth / colCount,
      cellHeight: sheetHeight / rowCount,
      cellAspect: sheetWidth / colCount / (sheetHeight / rowCount),
    };
  }

  const candidates = POW2_SIZES.filter((size) => size <= maxSize);
  let best: { width: number; height: number; err: number; area: number } | null = null;

  for (const width of candidates) {
    for (const height of candidates) {
      const cellAspect = width / colCount / (height / rowCount);
      const err = Math.abs(Math.log(cellAspect / aspect));
      const area = width * height;

      if (
        best === null ||
        err < best.err - 0.04 ||
        (Math.abs(err - best.err) <= 0.04 && area > best.area)
      ) {
        best = { width, height, err, area };
      }
    }
  }

  const chosen = best ?? { width: maxSize, height: maxSize };

  return {
    sheetWidth: chosen.width,
    sheetHeight: chosen.height,
    cellWidth: chosen.width / colCount,
    cellHeight: chosen.height / rowCount,
    cellAspect: chosen.width / colCount / (chosen.height / rowCount),
  };
}

export function fitRect(
  iw: number,
  ih: number,
  boxWidth: number,
  boxHeight: number,
  mode: "cover" | "contain" | "stretch",
) {
  if (mode === "stretch" || iw <= 0 || ih <= 0) {
    return { dx: 0, dy: 0, dw: boxWidth, dh: boxHeight };
  }

  const scale =
    mode === "cover"
      ? Math.max(boxWidth / iw, boxHeight / ih)
      : Math.min(boxWidth / iw, boxHeight / ih);
  const dw = iw * scale;
  const dh = ih * scale;

  return { dx: (boxWidth - dw) / 2, dy: (boxHeight - dh) / 2, dw, dh };
}
