"use client";

import { Badge } from "@/components/ui/badge";
import { Markdown } from "@/components/Markdown";
import { resultStatus, type MyVerdict, type QuestionGroup, type RecordedResult, type RunMeta, type Verdict } from "@/lib/acceptance";
import { VerdictControls } from "./VerdictControls";

interface Props {
  groups: QuestionGroup[];
  run: RunMeta | null;
  results: Record<string, RecordedResult>;
  mine: Record<string, MyVerdict>;
  disabled: boolean;
  onSave: (questionId: string, verdict: Verdict | null, note: string) => void;
}

const statusLabel = {
  answered: "Answered", gated: "Gated refusal", "model-refused": "Model refused",
  self: "Self-description", "needs-context": "Asked for context", error: "Error", none: "Not run",
} as const;

export function ResultsTab({ groups, run, results, mine, disabled, onSave }: Props) {
  return (
    <div className="flex flex-col gap-10">
      {run ? (
        <p className="rounded border border-rule bg-bay px-3 py-2 font-mono text-xs text-muted-foreground">
          run {run.ran_at.slice(0, 16).replace("T", " ")} · {run.count} questions · generation {run.chat_deployment} ({run.providers.chat}) ·
          embeddings {run.embed_deployment} ({run.providers.embed}) · rerank {run.rerank_model} ({run.providers.rerank}) · gate {run.threshold}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">No run recorded yet — run <code className="font-mono">SCRIPTS/run_acceptance.py</code>.</p>
      )}
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-6">
          <h2 className="border-b border-rule pb-2 font-display text-xl font-medium">{g.title} <span className="ml-2 rounded bg-signal/10 px-1.5 font-mono text-xs text-signal">{g.key}</span></h2>
          {g.questions.map((q) => {
            const r = results[q.id];
            const status = resultStatus(r);
            return (
              <article key={q.id} className="grid gap-4 md:grid-cols-[3.5rem_1fr_16rem]">
                <span className={`font-mono text-xs ${q.kind === "refuse" ? "text-hazard" : "text-signal"}`}>{q.id}</span>
                <div className="min-w-0">
                  <p className="font-medium">{q.question}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
                    <Badge variant={status === "answered" || status === "self" ? "secondary" : "outline"}>{statusLabel[status]}</Badge>
                    {r?.confidence != null && <span>relevance <strong className="text-type">{r.confidence.toFixed(3)}</strong></span>}
                    {r && <span>{r.elapsed_s}s</span>}
                    {r?.top_source && <span>top: {r.top_source}</span>}
                  </div>
                  {r?.answer ? (
                    <div className="mt-2 rounded border border-rule bg-bay px-4 py-3 text-sm"><Markdown>{r.answer}</Markdown></div>
                  ) : r?.error ? (
                    <p className="mt-2 font-mono text-xs text-hazard">{r.error}</p>
                  ) : null}
                  {r?.sources?.length ? <p className="mt-1 break-words font-mono text-xs text-muted-foreground">retrieved: {r.sources.slice(0, 5).join(" · ")}</p> : null}
                </div>
                <VerdictControls questionId={q.id} mine={mine[q.id]} disabled={disabled} onSave={onSave} />
              </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}
