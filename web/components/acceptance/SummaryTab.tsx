"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { filterSummary, type QuestionGroup, type Summary, type SummaryFilter } from "@/lib/acceptance";

interface Props { groups: QuestionGroup[]; summary: Summary | null }

const FILTERS: { key: SummaryFilter; label: string }[] = [
  { key: "all", label: "All" }, { key: "unscored", label: "Unscored" },
  { key: "disagreements", label: "Disagreements" }, { key: "failures", label: "Failures" },
];

/** Segments carry their count as text and the verdict's `-fg` colour, so they
 *  stay legible on the lighter dark-theme fills as well as the light theme's
 *  deep ones. */
function Bar({ counts }: { counts: Record<"pass" | "partial" | "fail", number> }) {
  const total = counts.pass + counts.partial + counts.fail;
  if (!total) return <span className="text-xs text-muted-foreground">—</span>;
  const seg = (n: number, cls: string, label: string) =>
    n > 0 && <span className={`${cls} flex h-5 items-center justify-center font-mono text-[11px] font-medium`} style={{ width: `${(n / total) * 100}%` }} title={label}>{n}</span>;
  return (
    <span className="flex w-40 gap-px overflow-hidden rounded-md" aria-label={`${counts.pass} pass, ${counts.partial} partial, ${counts.fail} fail`}>
      {seg(counts.pass, "bg-verdict-pass text-verdict-pass-fg", "pass")}
      {seg(counts.partial, "bg-verdict-partial text-verdict-partial-fg", "partial")}
      {seg(counts.fail, "bg-verdict-fail text-verdict-fail-fg", "fail")}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-rule bg-card p-4 shadow-soft">
      <p className="font-display text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SummaryTab({ groups, summary }: Props) {
  const [filter, setFilter] = useState<SummaryFilter>("all");
  if (!summary) return <p className="text-sm text-muted-foreground">Loading summary…</p>;
  const all = groups.flatMap((g) => g.questions);
  const byId = Object.fromEntries(all.map((q) => [q.id, q]));
  const ids = filterSummary(all.map((q) => q.id), summary, filter);
  const t = summary.totals;
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Scored" value={`${t.scored}/${t.questions}`} hint="questions with at least one verdict" />
        <Stat label="Testers" value={String(t.testers)} />
        <Stat label="Pass rate" value={t.pass_rate == null ? "—" : `${Math.round(t.pass_rate * 100)}%`} />
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter summary">
        {FILTERS.map((f) => (
          <Button key={f.key} size="lg" variant={filter === f.key ? "default" : "outline"} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</Button>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-rule bg-card shadow-soft">
        <Table>
          <TableHeader>
            <TableRow className="bg-bay/60 hover:bg-bay/60">
              <TableHead className="w-14">ID</TableHead>
              <TableHead>Question</TableHead>
              <TableHead className="w-44">Verdicts</TableHead>
              <TableHead>Testers</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ids.map((id) => {
              const s = summary.questions[id];
              return (
                <TableRow key={id}>
                  <TableCell className="font-mono text-xs text-signal">{id}</TableCell>
                  <TableCell className="whitespace-normal">
                    {byId[id]?.question}
                    {s?.disagreement && <Badge variant="outline" className="ml-2 border-verdict-partial text-verdict-partial">disagree</Badge>}
                  </TableCell>
                  <TableCell><Bar counts={s?.counts ?? { pass: 0, partial: 0, fail: 0 }} /></TableCell>
                  <TableCell className="whitespace-normal text-sm text-muted-foreground">{s?.testers.join(", ")}</TableCell>
                </TableRow>
              );
            })}
            {ids.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                  Nothing matches this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
