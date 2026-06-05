import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Seconds to clock string; `M:SS.dd` past a minute, `S.dds` under one. */
export function formatClock(sec: number, digits = 1): string {
  if (!Number.isFinite(sec)) return `${(0).toFixed(digits)}s`;
  if (sec >= 60) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toFixed(digits).padStart(digits + 3, "0")}`;
  }
  return `${sec.toFixed(digits)}s`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function checkerBg(px: number): string {
  return `bg-[conic-gradient(#0000_90deg,#80808015_0_180deg,#0000_0_270deg,#80808015_0)] bg-[length:${px}px_${px}px]`;
}
