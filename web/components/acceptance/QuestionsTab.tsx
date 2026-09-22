"use client";

import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import type { MyVerdict, QuestionGroup, Verdict } from "@/lib/acceptance";
import { cn } from "@/lib/utils";
import { VerdictControls } from "./VerdictControls";

interface Props {
  groups: QuestionGroup[];
  mine: Record<string, MyVerdict>;
  disabled: boolean;
  onSave: (questionId: string, verdict: Verdict | null, note: string) => void;
}

/** Each question is a card laid out on a plain responsive grid, not a
 *  <table>: shadcn's TableCell forces `white-space: nowrap`, and with no fixed
 *  column widths the question + must-contain text just kept growing the table,
 *  shoving the verdict column — this page's primary control — off-screen with
 *  no visible scrollbar affordance.
 *
 *  `lg:grid-cols-[3.5rem_1fr_16rem]`: the id and verdict columns are fixed, the
 *  question column is the only flexible track, and — unlike a table cell — a
 *  grid item's text wraps inside its track by default. `min-w-0` on that
 *  middle column is what lets it shrink to the track width instead of the
 *  browser's default "never smaller than its content" sizing. Below `lg` the
 *  columns collapse to one, stacking id / question / verdict.
 *
 *  The breakpoint is `lg` (1024px), not `md` (768px), because the page's own
 *  chrome eats into the content width before the content breakpoint does: at
 *  768px the sidebar (16rem) and page/card padding leave ~416px, and the fixed
 *  3.5rem + 16rem tracks plus two gaps alone take 344px of it — starving the
 *  question column to a couple of words per line. It is comfortable from
 *  ~1024px. */
export function QuestionsTab({ groups, mine, disabled, onSave }: Props) {
  // The "Unscored" filter is a snapshot of which ids were unscored the moment
  // it was switched on, not a live predicate. A live one would make a card
  // vanish the instant a verdict is picked — before the tester can type the
  // note, which only unlocks after a verdict. Toggling the filter again
  // refreshes the snapshot.
  const [unscoredIds, setUnscoredIds] = useState<Set<string> | null>(null);
  const remaining = groups.reduce((n, g) => n + g.questions.filter((q) => !mine[q.id]).length, 0);

  function chooseFilter(onlyUnscored: boolean) {
    setUnscoredIds(
      onlyUnscored
        ? new Set(groups.flatMap((g) => g.questions).filter((q) => !mine[q.id]).map((q) => q.id))
        : null,
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {disabled ? "Enter your name to start scoring." : remaining === 0 ? "Every question is scored — nice work." : `${remaining} still to score.`}
        </p>
        <div role="group" aria-label="Filter questions" className="flex gap-0.5 rounded-lg bg-bay p-0.5">
          {([[false, "All"], [true, "Unscored"]] as const).map(([value, label]) => (
            <button
              key={label}
              type="button"
              aria-pressed={(unscoredIds !== null) === value}
              onClick={() => chooseFilter(value)}
              className={cn(
                "h-7 rounded-md px-3 text-xs font-medium transition-colors",
                (unscoredIds !== null) === value ? "bg-card text-type shadow-soft" : "text-muted-foreground hover:text-type",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {groups.map((g) => {
        const scored = g.questions.filter((q) => mine[q.id]).length;
        const visible = unscoredIds ? g.questions.filter((q) => unscoredIds.has(q.id)) : g.questions;
        if (!visible.length) return null;
        return (
          <section key={g.key} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule pb-3">
              <h2 className="font-display text-xl font-semibold tracking-tight">{g.title}</h2>
              <span className="rounded-md bg-signal/10 px-1.5 py-0.5 font-mono text-xs text-signal">{g.key}</span>
              <span className="ml-auto flex items-center gap-1.5 font-mono text-xs text-muted-foreground tabular-nums">
                {scored === g.questions.length && <CircleCheck className="size-3.5 text-verdict-pass" aria-hidden="true" />}
                {scored}/{g.questions.length} scored
              </span>
              {g.note && <p className="basis-full text-sm text-muted-foreground">{g.note}</p>}
            </div>
            <div className="hidden gap-4 px-4 font-display text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase lg:grid lg:grid-cols-[3.5rem_1fr_16rem]">
              <span>ID</span>
              <span>Question</span>
              <span>Your verdict</span>
            </div>
            <ul className="flex flex-col gap-3">
              {visible.map((q) => (
                <li
                  key={q.id}
                  className="grid gap-4 rounded-2xl border border-rule bg-card p-4 shadow-soft lg:grid-cols-[3.5rem_1fr_16rem]"
                >
                  <span className={`h-fit w-fit rounded-md bg-bay px-2 py-1 font-mono text-xs ${q.kind === "refuse" ? "text-hazard" : "text-signal"}`}>{q.id}</span>
                  <div className="min-w-0">
                    <p className="font-medium">{q.question}</p>
                    {q.asked.length > 1 && (
                      <ol className="mt-1.5 list-decimal pl-5 text-sm text-muted-foreground">{q.asked.map((a) => <li key={a}>{a}</li>)}</ol>
                    )}
                    <div className="mt-2 rounded-xl bg-bay px-3.5 py-2.5 text-sm text-muted-foreground"><Markdown>{q.must_contain}</Markdown></div>
                    {q.source && <p className="mt-2 break-words font-mono text-xs text-muted-foreground">{q.source}</p>}
                  </div>
                  <VerdictControls questionId={q.id} mine={mine[q.id]} disabled={disabled} onSave={onSave} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
