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

function Bar({ counts }: { counts: Record<"pass" | "partial" | "fail", number> }) {
  const total = counts.pass + counts.partial + counts.fail;
  if (!total) return <span className="text-xs text-muted-foreground">—</span>;
  const seg = (n: number, cls: string, label: string) =>
    n > 0 && <span className={`${cls} flex h-4 items-center justify-center text-[10px] text-white`} style={{ width: `${(n / total) * 100}%` }} title={label}>{n}</span>;
  return (
    <span className="flex w-40 overflow-hidden rounded" aria-label={`${counts.pass} pass, ${counts.partial} partial, ${counts.fail} fail`}>
      {seg(counts.pass, "bg-verdict-pass", "pass")}
      {seg(counts.partial, "bg-verdict-partial", "partial")}
      {seg(counts.fail, "bg-verdict-fail", "fail")}
    </span>
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 rounded border border-rule bg-bay px-3 py-2 font-mono text-xs text-muted-foreground">
        <span><strong className="text-type">{t.scored}</strong>/{t.questions} scored</span>
        <span><strong className="text-type">{t.testers}</strong> testers</span>
        <span>pass rate <strong className="text-type">{t.pass_rate == null ? "—" : `${Math.round(t.pass_rate * 100)}%`}</strong></span>
        <span className="ml-auto flex gap-1">
          {FILTERS.map((f) => (
            <Button key={f.key} size="sm" variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>{f.label}</Button>
          ))}
        </span>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
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
                  <TableCell>
                    {byId[id]?.question}
                    {s?.disagreement && <Badge variant="outline" className="ml-2 border-verdict-partial text-verdict-partial">disagree</Badge>}
                  </TableCell>
                  <TableCell><Bar counts={s?.counts ?? { pass: 0, partial: 0, fail: 0 }} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s?.testers.join(", ")}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
