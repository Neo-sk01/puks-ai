"use client";

import { Markdown } from "@/components/Markdown";
import type { MyVerdict, QuestionGroup, Verdict } from "@/lib/acceptance";
import { VerdictControls } from "./VerdictControls";

interface Props {
  groups: QuestionGroup[];
  mine: Record<string, MyVerdict>;
  disabled: boolean;
  onSave: (questionId: string, verdict: Verdict | null, note: string) => void;
}

/** A plain responsive grid, not a <table>: shadcn's TableCell forces
 *  `white-space: nowrap`, and with no fixed column widths the question +
 *  must-contain text just kept growing the table (it measured ~1827px wide
 *  in a 1024px-wide container), shoving the verdict column — this page's
 *  primary control — off-screen with no visible scrollbar affordance.
 *
 *  `lg:grid-cols-[3.5rem_1fr_16rem]` is the same shape ResultsTab.tsx
 *  already uses (and the same id/verdict widths the old table's `w-14` /
 *  `w-64` columns had): the id and verdict columns are fixed, the question
 *  column is the only flexible track, and — unlike a table cell — a grid
 *  item's text wraps inside its track by default. `min-w-0` on that middle
 *  column is what lets it actually shrink to the track width instead of
 *  the browser's default "never smaller than its content" sizing. Below
 *  `lg` the columns collapse to one, stacking id / question / verdict.
 *
 *  The breakpoint is `lg` (1024px), not `md` (768px), because this page's
 *  own chrome eats into the content width before the content breakpoint
 *  does: the outer layout goes row at `md:flex-row` (AcceptanceView.tsx)
 *  and the Sidebar is `md:w-72` (288px) from that same point, so right at
 *  768px there's only ~400px left for the three columns — the fixed
 *  3.5rem + 16rem tracks plus two `gap-4`s alone consume 344px of that,
 *  starving the question column down to ~56px (measured live:
 *  `grid-template-columns: "56px 56px 256px"`) and wrapping question text
 *  to one or two words per line. That's a readability regression, not the
 *  original off-screen-controls bug — it clears by ~900px and is
 *  comfortable at 1024px+ — so the grid now waits for `lg` instead of
 *  switching on at the same breakpoint as the surrounding chrome. */
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
          <div className="hidden gap-4 pb-1 font-display text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground lg:grid lg:grid-cols-[3.5rem_1fr_16rem]">
            <span>ID</span>
            <span>Question</span>
            <span>Your verdict</span>
          </div>
          <div className="flex flex-col divide-y divide-rule">
            {g.questions.map((q) => (
              <div key={q.id} className="grid gap-4 py-4 lg:grid-cols-[3.5rem_1fr_16rem]">
                <span className={`font-mono text-xs ${q.kind === "refuse" ? "text-hazard" : "text-signal"}`}>{q.id}</span>
                <div className="min-w-0">
                  <p className="font-medium">{q.question}</p>
                  {q.asked.length > 1 && (
                    <ol className="mt-1 list-decimal pl-5 text-sm text-muted-foreground">{q.asked.map((a) => <li key={a}>{a}</li>)}</ol>
                  )}
                  <div className="mt-1 text-sm text-muted-foreground"><Markdown>{q.must_contain}</Markdown></div>
                  {q.source && <p className="mt-1 break-words font-mono text-xs text-muted-foreground">{q.source}</p>}
                </div>
                <VerdictControls questionId={q.id} mine={mine[q.id]} disabled={disabled} onSave={onSave} />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
