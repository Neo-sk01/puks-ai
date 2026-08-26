"use client";

import { Markdown } from "@/components/Markdown";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { MyVerdict, QuestionGroup, Verdict } from "@/lib/acceptance";
import { VerdictControls } from "./VerdictControls";

interface Props {
  groups: QuestionGroup[];
  mine: Record<string, MyVerdict>;
  disabled: boolean;
  onSave: (questionId: string, verdict: Verdict | null, note: string) => void;
}

export function QuestionsTab({ groups, mine, disabled, onSave }: Props) {
  return (
    <div className="flex flex-col gap-10">
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-3 border-b border-rule pb-2">
            <h2 className="font-display text-xl font-medium">{g.title}</h2>
            <span className="rounded bg-signal/10 px-1.5 font-mono text-xs text-signal">{g.key}</span>
            {g.note && <p className="text-sm text-muted-foreground">{g.note}</p>}
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">ID</TableHead>
                  <TableHead>Question</TableHead>
                  <TableHead className="w-64">Your verdict</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.questions.map((q) => (
                  <TableRow key={q.id}>
                    <TableCell className={`align-top font-mono text-xs ${q.kind === "refuse" ? "text-hazard" : "text-signal"}`}>{q.id}</TableCell>
                    <TableCell className="align-top">
                      <p className="font-medium">{q.question}</p>
                      {q.asked.length > 1 && (
                        <ol className="mt-1 list-decimal pl-5 text-sm text-muted-foreground">{q.asked.map((a) => <li key={a}>{a}</li>)}</ol>
                      )}
                      <div className="mt-1 text-sm text-muted-foreground"><Markdown>{q.must_contain}</Markdown></div>
                      {q.source && <p className="mt-1 font-mono text-xs text-muted-foreground">{q.source}</p>}
                    </TableCell>
                    <TableCell className="align-top">
                      <VerdictControls questionId={q.id} mine={mine[q.id]} disabled={disabled} onSave={onSave} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ))}
    </div>
  );
}
