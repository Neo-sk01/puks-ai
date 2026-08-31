"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ReviewRecord } from "@/lib/review";

interface Props {
  ids: string[];
  byId: Record<string, ReviewRecord>;
  current: string | null;
  seen: ReadonlySet<string>;
  noteCounts: Record<string, number>;
  onPick: (id: string) => void;
}

/** The reviewer's queue, grouped by warehouse area in the order prepare.py
 *  emitted it — one mental context at a time. Ids take the acceptance
 *  page's tone (signal for answerable, hazard for should-refuse); a tick
 *  means opened, the count means notes left. */
export function Queue({ ids, byId, current, seen, noteCounts, onPick }: Props) {
  return (
    <ScrollArea className="h-full">
      <div className="py-4">
        <h2 className="px-4 pb-1 font-display text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Your queue</h2>
        {ids.map((id, i) => {
          const r = byId[id];
          if (!r) return null;
          // A group header appears on the first record of each run of a group.
          const prev = i > 0 ? byId[ids[i - 1]] : undefined;
          const header = r.group_title !== prev?.group_title ? r.group_title : null;
          return (
            <div key={id}>
              {header && (
                <p className="mt-3 flex items-baseline gap-2 px-4 pb-1 text-sm">
                  <span className="font-display font-medium">{header}</span>
                  <span className="rounded bg-signal/10 px-1.5 font-mono text-[10px] text-signal">{r.group}</span>
                </p>
              )}
              <button
                type="button"
                onClick={() => onPick(id)}
                aria-current={id === current ? "true" : undefined}
                className={cn(
                  "grid w-full grid-cols-[2.6rem_1fr_auto] items-center gap-2 px-4 py-1.5 text-left text-sm hover:bg-bay",
                  id === current && "bg-bay shadow-[inset_2px_0_0_var(--color-signal)]",
                )}
              >
                <span className={cn("font-mono text-xs", r.kind === "refuse" ? "text-hazard" : "text-signal")}>
                  {seen.has(id) && <span className="text-muted-foreground" aria-label="opened">✓</span>}{id}
                </span>
                <span className="truncate" title={r.question}>{r.question}</span>
                <span className="min-w-[1.2rem] text-right font-mono text-[11px] text-muted-foreground">{noteCounts[id] || ""}</span>
              </button>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
