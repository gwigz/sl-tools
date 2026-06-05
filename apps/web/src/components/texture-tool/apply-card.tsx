"use client";

import { Box, Copy } from "lucide-react";
import { useSnapshot } from "valtio";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { NumberField } from "~/components/ui/field";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import type { ScriptLanguage } from "~/lib/sl/lsl";

import { ScriptBlock } from "./script-block";
import { settings } from "./store";

const LINK_TARGETS = [
  { value: "this", label: "This prim" },
  { value: "LINK_SET", label: "Whole linkset" },
  { value: "LINK_ROOT", label: "Root prim" },
  { value: "LINK_ALL_CHILDREN", label: "All children" },
  { value: "LINK_ALL_OTHERS", label: "All other prims" },
  { value: "specific", label: "Specific link #" },
];

export function ApplyCard({ script, onCopy }: { script: string; onCopy: () => void }) {
  const { scriptLang, linkMode, linkNum, faceAll, faceNum } = useSnapshot(settings);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Box className="size-4" /> Apply In-World
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <Tabs
            value={scriptLang}
            onValueChange={(v) => (settings.scriptLang = v as ScriptLanguage)}
          >
            <TabsList>
              <TabsTrigger value="lsl">LSL</TabsTrigger>
              <TabsTrigger value="slua">SLua</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={onCopy}>
            <Copy /> Copy
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Target Link</Label>
            <Select value={linkMode} onValueChange={(v) => (settings.linkMode = v ?? "this")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINK_TARGETS.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Face</Label>
            <Select
              value={faceAll ? "all" : "specific"}
              onValueChange={(v) => (settings.faceAll = v === "all")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All faces (ALL_SIDES)</SelectItem>
                <SelectItem value="specific">Specific face #</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {(linkMode === "specific" || !faceAll) && (
          <div className="grid grid-cols-2 gap-3">
            {linkMode === "specific" ? (
              <NumberField
                label="Link Number"
                value={linkNum}
                min={1}
                max={255}
                onChange={(v) => (settings.linkNum = v)}
              />
            ) : (
              <span />
            )}
            {!faceAll ? (
              <NumberField
                label="Face Number"
                value={faceNum}
                min={0}
                max={8}
                onChange={(v) => (settings.faceNum = v)}
              />
            ) : (
              <span />
            )}
          </div>
        )}
        <ScriptBlock code={script} />
        <p className="text-xs text-muted-foreground">
          Upload the PNG as a texture, drop it on the prim, then paste this into a new{" "}
          {scriptLang === "slua" ? "SLua" : "LSL"} script
        </p>
      </CardContent>
    </Card>
  );
}
