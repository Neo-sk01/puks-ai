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

function RunChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5 rounded-lg bg-bay px-2.5 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-type">{value}</span>
    </span>
  );
}

export function ResultsTab({ groups, run, results, mine, disabled, onSave }: Props) {
  return (
    <div className="flex flex-col gap-8">
      {run ? (
        <div className="rounded-2xl border border-rule bg-card p-4 shadow-soft">
          <p className="mb-2 font-display text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            Recorded run
          </p>
          <div className="flex flex-wrap gap-2 font-mono text-xs">
            <RunChip label="ran" value={run.ran_at.slice(0, 16).replace("T", " ")} />
            <RunChip label="questions" value={String(run.count)} />
            <RunChip label="generation" value={`${run.chat_deployment} (${run.providers.chat})`} />
            <RunChip label="embeddings" value={`${run.embed_deployment} (${run.providers.embed})`} />
            <RunChip label="rerank" value={`${run.rerank_model} (${run.providers.rerank})`} />
            <RunChip label="gate" value={String(run.threshold)} />
          </div>
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-rule p-4 text-sm text-muted-foreground">
          No run recorded yet — run <code className="font-mono text-type">SCRIPTS/run_acceptance.py</code>.
        </p>
      )}
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-4">
          <h2 className="flex items-center gap-3 border-b border-rule pb-3 font-display text-xl font-semibold tracking-tight">
            {g.title}
            <span className="rounded-md bg-signal/10 px-1.5 py-0.5 font-mono text-xs font-normal text-signal">{g.key}</span>
          </h2>
          {g.questions.map((q) => {
            const r = results[q.id];
            const status = resultStatus(r);
            return (
              <article key={q.id} className="grid gap-4 rounded-2xl border border-rule bg-card p-4 shadow-soft lg:grid-cols-[3.5rem_1fr_16rem]">
                <span className={`h-fit w-fit rounded-md bg-bay px-2 py-1 font-mono text-xs ${q.kind === "refuse" ? "text-hazard" : "text-signal"}`}>{q.id}</span>
                <div className="min-w-0">
                  <p className="font-medium">{q.question}</p>
                  {q.asked.length > 1 && (
                    <ol className="mt-1.5 list-decimal pl-5 text-sm text-muted-foreground">{q.asked.map((a) => <li key={a}>{a}</li>)}</ol>
                  )}
                  <div className="mt-2.5 flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
                    <Badge variant={status === "answered" || status === "self" ? "secondary" : "outline"}>{statusLabel[status]}</Badge>
                    {r?.confidence != null && <span>relevance <strong className="text-type">{r.confidence.toFixed(3)}</strong></span>}
                    {r && <span>{r.elapsed_s}s</span>}
                    {r?.top_source && <span className="min-w-0 break-words">top: {r.top_source}</span>}
                  </div>
                  {r?.answer ? (
                    <div className="mt-3 rounded-xl border border-rule bg-bay px-4 py-3 text-sm"><Markdown>{r.answer}</Markdown></div>
                  ) : r?.error ? (
                    <p className="mt-3 rounded-xl bg-hazard/10 px-3 py-2 font-mono text-xs text-hazard">{r.error}</p>
                  ) : null}
                  {r?.sources?.length ? <p className="mt-2 break-words font-mono text-xs text-muted-foreground">retrieved: {r.sources.slice(0, 5).join(" · ")}</p> : null}
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
