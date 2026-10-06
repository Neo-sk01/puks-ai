"use client";

import { useId } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { clampTopK } from "@/lib/history";
import type { AppConfig } from "@/lib/types";

interface Props {
  config: AppConfig | null;
  topK: number;
  onTopK: (value: number) => void;
  showSources: boolean;
  onShowSources: (value: boolean) => void;
}

/** Retrieval controls, moved out of the old always-on sidebar: they are
 *  tweaked rarely, and a popover keeps them one click away without spending a
 *  third of the screen on them. */
export function ChatSettings({ config, topK, onTopK, showSources, onShowSources }: Props) {
  const sliderId = useId();
  const switchLabelId = useId();
  const min = config?.top_k_min ?? 3;
  const max = config?.top_k_max ?? 10;
  const fill = ((topK - min) / Math.max(1, max - min)) * 100;

  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" className="h-9 gap-2 px-3" />}
        aria-label="Retrieval settings"
      >
        <SlidersHorizontal aria-hidden="true" />
        <span className="hidden sm:inline">Settings</span>
      </PopoverTrigger>
      <PopoverContent>
        <div className="space-y-5">
          <div>
            <PopoverTitle>Retrieval settings</PopoverTitle>
            <PopoverDescription className="mt-0.5">
              Tune how much documentation each answer is built from.
            </PopoverDescription>
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={sliderId} className="text-sm font-medium">
                Sources per answer
              </label>
              <span className="rounded-md bg-bay px-2 py-0.5 font-mono text-sm tabular-nums">{topK}</span>
            </div>
            <input
              id={sliderId}
              type="range"
              min={min}
              max={max}
              value={topK}
              style={{ "--fill": `${fill}%` } as React.CSSProperties}
              onChange={(e) =>
                onTopK(config ? clampTopK(Number(e.target.value), config) : Number(e.target.value))
              }
            />
            <p className="text-xs text-muted-foreground">
              More sources give broader context, but make answers slower.
            </p>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div>
              <p id={switchLabelId} className="text-sm font-medium">
                Expand sources by default
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Show the retrieved chunks under every answer.
              </p>
            </div>
            <Switch checked={showSources} onCheckedChange={onShowSources} aria-labelledby={switchLabelId} />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
