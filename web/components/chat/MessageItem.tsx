"use client";

import { useId, useState } from "react";
import { ChevronDown, ShieldAlert } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import { Markdown } from "@/components/Markdown";
import { RetrievalPanel } from "@/components/RetrievalPanel";
import { PuksMark } from "@/components/shell/Brand";
import { formatElapsed, metaString } from "@/lib/format";
import type { ChatMessage, Chunk } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  message: ChatMessage;
  /** True only for the last assistant message while a response is in flight. */
  streaming: boolean;
  /** The global "expand sources by default" setting. */
  showSources: boolean;
}

/** The provenance rail — the signature element. A 3px bar under the
 *  assistant's avatar, running the full height of its turn:
 *
 *  - Refused turn: solid --color-hazard, the only colour in that turn.
 *  - Streaming, before the first token: a slow shimmer — gpt-5 reasons
 *    before its first output token, so this covers the dead air.
 *  - Otherwise: segmented into up to three stacked parts for the top
 *    chunk's retrievers (dense, bm25, exact) — lit in --color-brand (AGL Yellow),
 *    unlit in --color-rule.
 *
 *  Decorative only (aria-hidden); the header chips and footer already carry
 *  this information as text. */
function ProvenanceRail({ message, waiting }: { message: ChatMessage; waiting: boolean }) {
  const base = "mt-2 min-h-6 w-[3px] flex-1 overflow-hidden rounded-full";

  if (message.refused) {
    return <div aria-hidden="true" className={cn(base, "bg-hazard")} />;
  }

  if (waiting) {
    return (
      <div
        aria-hidden="true"
        className={cn(base, "animate-shimmer bg-[length:100%_300%] bg-gradient-to-b from-rule via-brand to-rule")}
      />
    );
  }

  const chunk = message.retrieved?.chunks?.[0];
  if (!chunk) return <div aria-hidden="true" className={cn(base, "bg-rule")} />;

  const segments: Array<[string, boolean]> = [
    ["dense", chunk.in_dense],
    ["bm25", chunk.in_bm25],
    ["exact", chunk.in_exact],
  ];

  return (
    <div aria-hidden="true" className={cn(base, "flex flex-col gap-[2px]")}>
      {segments.map(([key, lit]) => (
        <div key={key} className={lit ? "flex-1 bg-brand" : "flex-1 bg-rule"} />
      ))}
    </div>
  );
}

/** The record header for the top chunk: SOURCE · CATEGORY · REL 0.870. It is
 *  why a support engineer can trust the SQL below before pasting it into
 *  production. Plex Mono + tabular-nums for the number that gets compared
 *  across turns. */
function HeaderChips({ chunk, confidence }: { chunk: Chunk; confidence: number }) {
  const source = metaString(chunk.metadata, "source");
  const category = metaString(chunk.metadata, "category");
  const pill = "max-w-[16rem] truncate rounded-full bg-bay px-2 py-0.5 text-[11px] text-muted-foreground";
  return (
    <>
      {source && (
        <span className={pill} title={source}>
          {source}
        </span>
      )}
      {category && <span className={pill}>{category}</span>}
      <span className="rounded-full bg-bay px-2 py-0.5 font-mono text-[11px] tabular-nums text-type">
        REL {confidence.toFixed(3)}
      </span>
    </>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-1 text-sm text-muted-foreground">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 animate-dot rounded-full bg-signal"
            style={{ animationDelay: `${i * 0.16}s` }}
          />
        ))}
      </span>
      {label}
    </div>
  );
}

function outcomeLine(message: ChatMessage): string | undefined {
  const { done, retrieved } = message;
  if (!done) return undefined;
  if (done.refused) {
    return `Top relevance ${done.confidence?.toFixed(3)} is below the ${done.threshold?.toFixed(2)} threshold.`;
  }
  if (done.reason === "self_description") {
    return "Answered from the assistant's own description — no documents were retrieved.";
  }
  if (done.reason === "needs_context") {
    return "Asked for clarification — no earlier conversation to connect this to.";
  }
  return [
    retrieved ? `Top relevance ${retrieved.confidence.toFixed(3)}` : undefined,
    done.model,
    formatElapsed(done.elapsed_ms),
  ]
    .filter(Boolean)
    .join(" · ");
}

function AssistantMessage({ message, streaming, showSources }: Props) {
  const [sourcesOverride, setSourcesOverride] = useState<boolean | null>(null);
  const panelId = useId();

  const chunks = message.retrieved?.chunks ?? [];
  const topChunk = chunks[0];
  const waiting = streaming && !message.content;
  const sourcesOpen = (sourcesOverride ?? showSources) && chunks.length > 0;
  const outcome = outcomeLine(message);
  const genuineRefusal = message.done?.refused === true;

  return (
    <article className="flex animate-msg-in gap-3 md:gap-4">
      <div className="flex flex-col items-center">
        <PuksMark className="size-8 text-sm" />
        <ProvenanceRail message={message} waiting={waiting} />
      </div>

      <div className="min-w-0 flex-1 space-y-3 pb-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="font-display text-sm font-semibold">Puks</span>
          {topChunk && message.retrieved && (
            <HeaderChips chunk={topChunk} confidence={message.retrieved.confidence} />
          )}
        </div>

        {waiting ? (
          <Thinking
            label={chunks.length ? `Writing an answer from ${chunks.length} sources…` : "Searching documentation…"}
          />
        ) : message.refused ? (
          <div role="note" className="rounded-xl border border-hazard/40 bg-hazard/10 p-4 text-hazard">
            {genuineRefusal && (
              <p className="mb-1 flex items-center gap-2 font-display text-sm font-semibold">
                <ShieldAlert className="size-4" aria-hidden="true" />
                Not answerable from the documentation
              </p>
            )}
            <div className="text-type">
              <Markdown>{message.content}</Markdown>
            </div>
          </div>
        ) : (
          message.content && <Markdown>{message.content}</Markdown>
        )}

        {!streaming && (message.content || message.done) && (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-muted-foreground">
            {!message.refused && message.content && <CopyButton text={message.content} label="Copy" />}
            {chunks.length > 0 && (
              <button
                type="button"
                aria-expanded={sourcesOpen}
                aria-controls={panelId}
                onClick={() => setSourcesOverride(!sourcesOpen)}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-medium transition-colors hover:bg-bay hover:text-type"
              >
                Sources · {chunks.length}
                <ChevronDown
                  className={cn("size-3.5 transition-transform", sourcesOpen && "rotate-180")}
                  aria-hidden="true"
                />
              </button>
            )}
            {outcome && <span className="px-2">{outcome}</span>}
          </div>
        )}

        {sourcesOpen && message.retrieved && <RetrievalPanel id={panelId} retrieved={message.retrieved} />}
      </div>
    </article>
  );
}

export function MessageItem(props: Props) {
  const { message } = props;

  if (message.role === "user") {
    return (
      <article className="flex animate-msg-in justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-bay px-4 py-2.5 break-words whitespace-pre-wrap text-type ring-1 ring-rule/70">
          {message.content}
        </p>
      </article>
    );
  }

  return <AssistantMessage {...props} />;
}
