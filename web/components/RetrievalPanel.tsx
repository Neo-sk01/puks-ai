"use client";

import type { Chunk, RetrievedPayload } from "@/lib/types";

function provenance(chunk: Chunk): string[] {
  const found = [
    chunk.in_dense && "dense",
    chunk.in_bm25 && "bm25",
    chunk.in_exact && "exact",
  ].filter(Boolean) as string[];
  return found.length ? found : ["fusion"];
}

/** The retrieval debug panel — replaces the Streamlit expander. This is how a
 *  support engineer checks the answer came from the right table's docs before
 *  pasting generated SQL into production: rank, provenance, Cohere relevance,
 *  fusion score, doc type, metadata, and full chunk text.
 *
 *  Colours per design-direction.md: --color-bay for the raised surface,
 *  --color-rule for hairlines, the text-muted-foreground utility (AGL blue
 *  70 % tint, wired straight to --color-agl-blue-70 in globals.css) for
 *  labels, --color-signal for the provenance chips (the rail's colour,
 *  reused here as the one place those retriever names appear as visible
 *  text). */
export function RetrievalPanel({ retrieved }: { retrieved: RetrievedPayload }) {
  if (!retrieved.chunks.length) return null;

  return (
    <details className="rounded-lg border border-rule bg-bay">
      <summary className="cursor-pointer px-4 py-2 text-sm text-muted-foreground">
        Retrieved context — {retrieved.chunks.length} chunks, top relevance{" "}
        {retrieved.confidence.toFixed(3)}
      </summary>

      <div className="space-y-5 px-4 pb-4">
        {retrieved.chunks.map((chunk, rank) => (
          <section key={chunk.index} className="space-y-2 border-t border-rule pt-4">
            <header className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-type">Rank {rank + 1}</span>
              <span className="text-muted-foreground">found by</span>
              {provenance(chunk).map((source) => (
                <code
                  key={source}
                  className="rounded bg-signal/10 px-1.5 py-0.5 font-mono text-xs uppercase tracking-[0.04em] text-signal"
                >
                  {source}
                </code>
              ))}
            </header>

            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Cohere relevance</dt>
                <dd className="font-mono tabular-nums text-type">
                  {chunk.relevance_score.toFixed(3)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Fusion score</dt>
                <dd className="font-mono tabular-nums text-type">
                  {chunk.fusion_score.toFixed(4)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Doc type</dt>
                <dd className="truncate font-mono text-type">{chunk.doc_type}</dd>
              </div>
            </dl>

            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">Metadata</summary>
              <pre className="mt-2 overflow-x-auto rounded bg-ink p-3 font-mono text-xs text-type">
                {JSON.stringify(chunk.metadata, null, 2)}
              </pre>
            </details>

            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Text ({chunk.text.length} chars)
              </summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">{chunk.text}</p>
            </details>
          </section>
        ))}
      </div>
    </details>
  );
}
