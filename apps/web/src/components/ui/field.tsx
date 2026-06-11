"use client"

import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field"
import { Minus, MoveHorizontal, Plus } from "lucide-react"

import { Label } from "~/components/ui/label"
import { Slider } from "~/components/ui/slider"
import { Switch } from "~/components/ui/switch"
import { cn } from "~/lib/utils"

/** Full-bleed section divider: stretches to the card edges past CardContent padding. */
export function CardDivider() {
  return <div className="-mx-3 my-1.5 h-px bg-foreground/10" />
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
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  suffix?: string
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
              const n = Number(e.target.value)
              if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
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
  )
}

const NUMBER_BUTTON_CLASSES =
  "flex h-7 w-8 shrink-0 items-center justify-center border border-input bg-input/20 text-muted-foreground transition-colors select-none hover:text-foreground focus-visible:relative focus-visible:z-10 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30 [&_svg]:size-3.5"

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <NumberFieldPrimitive.Root
      value={value}
      min={min}
      max={max}
      step={step}
      onValueChange={(next) => {
        if (next !== null) {
          onChange(Math.min(max, Math.max(min, next)))
        }
      }}
      className="flex flex-col gap-1.5"
    >
      <NumberFieldPrimitive.ScrubArea className="w-fit cursor-ew-resize">
        <Label className="cursor-ew-resize text-xs">{label}</Label>
        <NumberFieldPrimitive.ScrubAreaCursor className="drop-shadow-sm">
          <MoveHorizontal className="size-4 text-foreground" />
        </NumberFieldPrimitive.ScrubAreaCursor>
      </NumberFieldPrimitive.ScrubArea>
      <NumberFieldPrimitive.Group className="flex">
        <NumberFieldPrimitive.Decrement
          className={cn(NUMBER_BUTTON_CLASSES, "rounded-l-md border-r-0")}
        >
          <Minus />
        </NumberFieldPrimitive.Decrement>
        <NumberFieldPrimitive.Input className="h-7 w-full min-w-0 border border-input bg-input/20 px-2 py-0.5 text-center text-sm tabular-nums transition-colors outline-none focus-visible:relative focus-visible:z-10 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-xs/relaxed dark:bg-input/30" />
        <NumberFieldPrimitive.Increment
          className={cn(NUMBER_BUTTON_CLASSES, "rounded-r-md border-l-0")}
        >
          <Plus />
        </NumberFieldPrimitive.Increment>
      </NumberFieldPrimitive.Group>
    </NumberFieldPrimitive.Root>
  )
}

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  inline = false,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
  inline?: boolean
}) {
  if (inline) {
    return (
      <label className="flex cursor-pointer items-center gap-2 text-xs">
        <Switch checked={checked} onCheckedChange={onChange} />
        {label}
      </label>
    )
  }
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <div className="flex flex-col">
        <span className="text-xs font-medium">{label}</span>
        {hint && <span className="text-[0.7rem] text-muted-foreground">{hint}</span>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}
