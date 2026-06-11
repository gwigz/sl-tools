"use client"

import { RotateCcw } from "lucide-react"
import { useSnapshot } from "valtio"

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "~/components/ui/card"
import { ScrollArea } from "~/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select"
import { Slider } from "~/components/ui/slider"
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs"
import {
  type AvatarData,
  clampParamValue,
  paramsForGroup,
  SHAPE_GROUPS,
  type ShapeGroupKey,
  type ShapeParam,
  type ShapeValues,
} from "~/lib/sl/shape"

import { currentSex, setSex, state, ui } from "./store"

const GRABBABLE = "**:data-[slot=slider-control]:py-2"

const BODY_GROUPS: ShapeGroupKey[] = ["shape_body", "shape_torso", "shape_legs"]

function toPercent(param: ShapeParam, value: number): number {
  if (param.max === param.min) {
    return 0
  }

  return Math.round(((value - param.min) / (param.max - param.min)) * 100)
}

function fromPercent(param: ShapeParam, percent: number): number {
  return param.min + (percent / 100) * (param.max - param.min)
}

function ParamSlider({
  param,
  value,
  overridden,
}: {
  param: ShapeParam
  value: number
  overridden: boolean
}) {
  const percent = toPercent(param, clampParamValue(param, value))

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs">{param.label}</span>
        <span className="flex items-center gap-1">
          {overridden && (
            <Button
              variant="ghost"
              size="icon"
              className="size-5"
              title="Reset"
              onClick={() => {
                delete state.overrides[param.id]
              }}
            >
              <RotateCcw className="size-3" />
            </Button>
          )}
          <span className="w-8 text-right font-mono text-xs text-muted-foreground tabular-nums">
            {percent}
          </span>
        </span>
      </div>
      <Slider
        className={GRABBABLE}
        value={percent}
        min={0}
        max={100}
        step={1}
        onValueChange={(next) => {
          const raw = Array.isArray(next) ? next[0] : next

          state.overrides[param.id] = fromPercent(param, raw as number)
        }}
      />
      <div className="flex justify-between text-[10px] text-muted-foreground/70">
        <span>{param.labelMin}</span>
        <span>{param.labelMax}</span>
      </div>
    </div>
  )
}

function BlendRow({ groups, label }: { groups: ShapeGroupKey[]; label: string }) {
  const snap = useSnapshot(state)
  const blends = groups.map((group) => snap.blends[group])
  const first = blends[0]
  const uniform =
    first !== undefined &&
    blends.every(
      (blend) => blend && blend.sourceId === first.sourceId && blend.amount === first.amount,
    )
  const active = uniform ? first : undefined
  const amount = Math.round((active?.amount ?? 0) * 100)

  if (snap.shapes.length === 0) {
    return (
      <p className="rounded-md bg-muted/50 px-2 py-1.5 text-[10px] text-muted-foreground">
        Import more shapes to blend from another shape.
      </p>
    )
  }

  const items = [
    { value: null, label: "None" },
    ...snap.shapes.map((shape) => ({ value: shape.id, label: shape.name })),
  ]

  return (
    <div className="flex flex-col gap-1.5 rounded-md bg-muted/50 p-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] font-medium text-muted-foreground uppercase">
          {label}
        </span>
        <Select
          items={items}
          value={active?.sourceId ?? null}
          onValueChange={(sourceId) => {
            for (const group of groups) {
              if (sourceId === null) {
                delete state.blends[group]
              } else {
                state.blends[group] = {
                  sourceId: sourceId as string,
                  amount: active?.amount ?? 1,
                }
              }
            }
          }}
        >
          <SelectTrigger size="sm" className="h-6 w-auto min-w-0 flex-1 text-xs">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value ?? "none"} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {active && (
        <div className="flex items-center gap-2">
          <Slider
            className={GRABBABLE}
            value={amount}
            min={0}
            max={100}
            step={1}
            onValueChange={(next) => {
              const raw = Array.isArray(next) ? next[0] : next

              for (const group of groups) {
                const blend = state.blends[group]

                if (blend) {
                  blend.amount = (raw as number) / 100
                }
              }
            }}
          />
          <span className="w-9 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
            {amount}%
          </span>
        </div>
      )}
    </div>
  )
}

export function SlidersCard({
  data,
  values,
}: {
  data: AvatarData | null
  values: ShapeValues | null
}) {
  const snap = useSnapshot(state)
  const uiSnap = useSnapshot(ui)

  if (!data || !values) {
    return null
  }

  const sex = currentSex(snap)

  return (
    <Card className="overflow-hidden pb-0 select-none">
      <CardHeader className="items-center">
        <CardTitle>Shape Sliders</CardTitle>
        <CardAction className="row-span-1 self-center">
          <Tabs value={sex} onValueChange={(next) => setSex(next === "male")}>
            <TabsList>
              <TabsTrigger value="female">Female</TabsTrigger>
              <TabsTrigger value="male">Male</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent className="border-t border-foreground/10 p-0">
        {snap.shapes.length > 0 && (
          <div className="border-b border-foreground/10 p-2">
            <BlendRow groups={BODY_GROUPS} label="Body · Torso · Legs" />
          </div>
        )}
        <ScrollArea className="h-[540px] lg:h-[620px]">
          <Accordion
            value={uiSnap.activeGroup ? [uiSnap.activeGroup] : []}
            onValueChange={(next) => {
              const list = Array.isArray(next) ? next : [next]
              const open = list[0] as ShapeGroupKey | undefined

              ui.activeGroup = open ?? null
            }}
            multiple={false}
            className="rounded-none border-0"
          >
            {SHAPE_GROUPS.map((group) => {
              const params = paramsForGroup(data, group.key).filter(
                (param) => param.sex === "both" || param.sex === sex,
              )
              const overriddenCount = params.filter(
                (param) => snap.overrides[param.id] !== undefined,
              ).length
              const blendActive = snap.blends[group.key] !== undefined

              return (
                <AccordionItem key={group.key} value={group.key}>
                  <AccordionTrigger>
                    <span className="flex items-center gap-2">
                      {group.label}
                      {blendActive && (
                        <Badge variant="secondary" className="text-[10px]">
                          Blended
                        </Badge>
                      )}
                      {overriddenCount > 0 && (
                        <Badge variant="outline" className="text-[10px]">
                          {overriddenCount} Tweaked
                        </Badge>
                      )}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="flex flex-col gap-2">
                      <BlendRow groups={[group.key]} label="Blend From" />
                      {params.map((param) => (
                        <ParamSlider
                          key={param.id}
                          param={param}
                          value={values[param.id] ?? param.default}
                          overridden={snap.overrides[param.id] !== undefined}
                        />
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
          </Accordion>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
