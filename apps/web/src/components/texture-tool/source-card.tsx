"use client";

import { LoaderCircle, Video } from "lucide-react";

import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";

import { Dropzone } from "./dropzone";
import type { SourceMeta } from "~/hooks/use-frame-extraction";

const SOURCE_ACCEPT = "video/*,image/gif,image/webp,image/apng";

export function SourceCard({
  onSelect,
  meta,
  loadingSource,
  preview,
}: {
  onSelect: (file: File) => void;
  meta: SourceMeta | null;
  loadingSource: boolean;
  preview: ImageBitmap | null;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Video className="size-4" /> Source
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Dropzone
          onSelect={onSelect}
          accept={SOURCE_ACCEPT}
          compact={!!meta}
          preview={preview}
          label={meta?.name}
        />
        {loadingSource && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="size-3 animate-spin" /> Decoding…
          </p>
        )}
        {meta && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            <Badge variant="secondary">{meta.kind}</Badge>
            <Badge variant="outline">
              {meta.width}×{meta.height}px
            </Badge>
            {meta.durationMs > 0 && (
              <Badge variant="outline">{(meta.durationMs / 1000).toFixed(1)}s</Badge>
            )}
            {meta.nativeFrameCount > 0 && (
              <Badge variant="outline">{meta.nativeFrameCount} native frames</Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
