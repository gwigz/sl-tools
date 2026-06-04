"use client";

import { useId } from "react";
import { HexColorInput, RgbaColorPicker, RgbColorPicker } from "react-colorful";

import { Popover, PopoverContent, PopoverTrigger } from "~/components/ui/popover";
import { cn } from "~/lib/utils";

// `a` is 0..1 (react-colorful convention); r/g/b are 0..255 (SL convention).
type Rgba = { r: number; g: number; b: number; a: number };

const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
const hex2 = (n: number) => clamp(Math.round(n), 255).toString(16).padStart(2, "0");

function parseColor(input: string): Rgba {
  let s = input.trim().replace(/^#/, "");
  if (s.length === 3 || s.length === 4) {
    s = s
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const r = Number.parseInt(s.slice(0, 2), 16);
  const g = Number.parseInt(s.slice(2, 4), 16);
  const b = Number.parseInt(s.slice(4, 6), 16);
  const a = s.length >= 8 ? Number.parseInt(s.slice(6, 8), 16) / 255 : 1;
  return {
    r: Number.isNaN(r) ? 0 : r,
    g: Number.isNaN(g) ? 0 : g,
    b: Number.isNaN(b) ? 0 : b,
    a: Number.isNaN(a) ? 1 : a,
  };
}

function toHex({ r, g, b, a }: Rgba, withAlpha: boolean): string {
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  return withAlpha && a < 1 ? base + hex2(a * 255) : base;
}

// A single 0–255 channel input (R, G, B, or A) shown beneath the picker.
function ChannelInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-1 flex-col items-center gap-1">
      <label htmlFor={id} className="text-[0.65rem] text-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min={0}
        max={255}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(clamp(Math.round(n), 255));
        }}
        className="h-7 w-full rounded-md border bg-transparent text-center font-mono text-xs tabular-nums outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
    </div>
  );
}

// Swatch trigger that opens a popover with an HSV picker, SL-style 0–255 RGB(A)
// fields, and a hex field. `value`/`onChange` use `#rrggbb` (or `#rrggbbaa` when
// `alpha` is enabled and not fully opaque).
export function ColorPicker({
  value,
  onChange,
  alpha = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  alpha?: boolean;
  className?: string;
}) {
  const rgba = parseColor(value);
  const emit = (next: Partial<Rgba>) => onChange(toHex({ ...rgba, ...next }, alpha));

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex h-7 items-center gap-2 rounded-md border bg-transparent px-1.5 transition-colors hover:bg-input/50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
          className,
        )}
        aria-label="Pick background color"
      >
        <span className="size-5 overflow-hidden rounded-sm border shadow-sm bg-[conic-gradient(#0000_90deg,#80808040_0_180deg,#0000_0_270deg,#80808040_0)] bg-[length:8px_8px]">
          <span className="block size-full" style={{ backgroundColor: value }} />
        </span>
        <span className="font-mono text-xs uppercase">{value}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-auto flex-col gap-3 p-3">
        {alpha ? (
          <RgbaColorPicker color={rgba} onChange={(c) => onChange(toHex(c, true))} />
        ) : (
          <RgbColorPicker color={rgba} onChange={(c) => onChange(toHex({ ...c, a: 1 }, false))} />
        )}
        <div className="flex gap-2">
          <ChannelInput label="R" value={rgba.r} onChange={(r) => emit({ r })} />
          <ChannelInput label="G" value={rgba.g} onChange={(g) => emit({ g })} />
          <ChannelInput label="B" value={rgba.b} onChange={(b) => emit({ b })} />
          {alpha && (
            <ChannelInput
              label="A"
              value={Math.round(rgba.a * 255)}
              onChange={(a) => emit({ a: a / 255 })}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Hex</span>
          <div className="flex flex-1 items-center rounded-md border bg-transparent px-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
            <span className="text-xs text-muted-foreground">#</span>
            <HexColorInput
              color={value}
              alpha={alpha}
              onChange={onChange}
              className="h-7 w-full bg-transparent font-mono text-xs uppercase outline-none"
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
