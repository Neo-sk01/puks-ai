"use client";

import { ChevronRight } from "lucide-react";
import { metaString } from "@/lib/format";
import type { Chunk, RetrievedPayload } from "@/lib/types";

function provenance(chunk: Chunk): string[] {
  const found = [
    chunk.in_dense && "dense",
    chunk.in_bm25 && "bm25",
    chunk.in_exact && "exact",
  ].filter(Boolean) as string[];
  return found.length ? found : ["fusion"];
}

/** A chunk's best human-readable name: where it came from, else what kind of
 *  chunk it is. */
function chunkTitle(chunk: Chunk): string {
  return (
    metaString(chunk.metadata, "source") ||
    metaString(chunk.metadata, "procedure_name") ||
    metaString(chunk.metadata, "table_name") ||
    chunk.doc_type
  );
}

function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group/details">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded text-xs text-muted-foreground transition-colors hover:text-type [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3.5 transition-transform group-open/details:rotate-90"
          aria-hidden="true"
        />
        {summary}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/** The retrieval debug panel. This is how a support engineer checks the
 *  answer came from the right table's docs before pasting generated SQL into
 *  production: rank, provenance, Cohere relevance, fusion score, doc type,
 *  metadata and the full chunk text — one card per chunk, best first. */
export function RetrievalPanel({ retrieved, id }: { retrieved: RetrievedPayload; id?: string }) {
  if (!retrieved.chunks.length) return null;

  return (
    <section id={id} aria-label="Retrieved sources" className="animate-fade-in space-y-2">
      {retrieved.chunks.map((chunk, rank) => {
        const relevance = Math.max(0, Math.min(1, chunk.relevance_score));
        return (
          <article
            key={chunk.index}
            className="space-y-2.5 rounded-xl border border-rule bg-card p-3.5 shadow-soft"
          >
            <header className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
              <span className="grid size-5 shrink-0 place-items-center rounded-md bg-bay font-mono text-[11px] text-muted-foreground">
                {rank + 1}
              </span>
              <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-type" title={chunkTitle(chunk)}>
                {chunkTitle(chunk)}
              </h3>
              <span className="flex items-center gap-1" aria-label="Found by">
                {provenance(chunk).map((source) => (
                  <code
                    key={source}
                    className="rounded-md bg-signal/10 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.04em] text-signal"
                  >
                    {source}
                  </code>
                ))}
              </span>
            </header>

            <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <dt>Relevance</dt>
                <dd className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-16 overflow-hidden rounded-full bg-rule"
                  >
                    <span
                      className="block h-full rounded-full bg-signal"
                      style={{ width: `${relevance * 100}%` }}
                    />
                  </span>
                  <span className="font-mono tabular-nums text-type">
                    {chunk.relevance_score.toFixed(3)}
                  </span>
                </dd>
              </div>
              <div className="flex items-center gap-2">
                <dt>Fusion</dt>
                <dd className="font-mono tabular-nums text-type">{chunk.fusion_score.toFixed(4)}</dd>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <dt>Type</dt>
                <dd className="truncate font-mono text-type">{chunk.doc_type}</dd>
              </div>
            </dl>

            <div className="space-y-1.5 border-t border-rule pt-2.5">
              <Disclosure summary={`Text (${chunk.text.length} chars)`}>
                <p className="scroll-thin max-h-64 overflow-y-auto rounded-lg bg-bay p-3 text-xs leading-relaxed break-words whitespace-pre-wrap text-type">
                  {chunk.text}
                </p>
              </Disclosure>
              <Disclosure summary="Metadata">
                <pre className="scroll-thin overflow-x-auto rounded-lg bg-bay p-3 font-mono text-xs text-type">
                  {JSON.stringify(chunk.metadata, null, 2)}
                </pre>
              </Disclosure>
            </div>
          </article>
        );
      })}
    </section>
  );
}
