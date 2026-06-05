"use client";

import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";

/** Full-bleed section divider: stretches to the card edges past CardContent padding. */
export function CardDivider() {
  return <div className="-mx-3 my-1.5 h-px bg-foreground/10" />;
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        <div className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
            }}
            className="w-12 rounded bg-transparent text-right tabular-nums outline-none focus:text-foreground [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {suffix && <span>{suffix}</span>}
        </div>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </div>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  inline = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <Switch checked={checked} onCheckedChange={onChange} />
        {label}
      </label>
    );
  }
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-xs font-medium">{label}</span>
        {hint && <span className="text-[0.7rem] text-muted-foreground">{hint}</span>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
