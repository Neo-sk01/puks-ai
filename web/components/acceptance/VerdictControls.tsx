"use client";

import { useState } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Textarea } from "@/components/ui/textarea";
import { VERDICTS, verdictLabel, type MyVerdict, type Verdict } from "@/lib/acceptance";

interface Props {
  questionId: string;
  mine: MyVerdict | undefined;
  disabled: boolean;
  onSave: (questionId: string, verdict: Verdict | null, note: string) => void;
}

/** Base UI's ToggleGroup (@base-ui/react/toggle-group) is array-valued —
 *  `value`/`onValueChange` carry `Value[]`, not a single string, and there
 *  is no `type="single"` prop. Its default `multiple={false}` already gives
 *  the behaviour the brief asked for: pressing an unpressed item replaces
 *  whatever was pressed (single-select), and pressing the already-pressed
 *  item empties the array (clears). So `[verdict] | []` stands in for the
 *  brief's `current: Verdict | ""`.
 *
 *  Styling: the generated toggle.tsx pins its "on" look to `aria-pressed:`,
 *  not `data-[state=on]:` (Base UI never sets `data-state`; it sets
 *  `aria-pressed="true"/"false"` unconditionally and `data-pressed=""` only
 *  when true). This file follows that same working hook for the tone map. */
const tone: Record<Verdict, string> = {
  pass: "aria-pressed:bg-verdict-pass aria-pressed:text-white",
  partial: "aria-pressed:bg-verdict-partial aria-pressed:text-white",
  fail: "aria-pressed:bg-verdict-fail aria-pressed:text-white",
};

/** PASS / PART / FAIL plus a note. Clicking the active verdict clears it.
 *  The note saves on blur or Cmd/Ctrl+Enter, only when it changed.
 *
 *  The local `note` draft is seeded from `mine?.note`, but `mine` arrives
 *  asynchronously (loadMine resolves after this component is already
 *  mounted) — without resyncing, a verdict saved in an earlier session would
 *  show its PASS/PART/FAIL chip correctly (that reads `mine` directly every
 *  render) but an empty note box on reload. Resyncing during render — React's
 *  documented "adjusting state when a prop changes" recipe — keeps the draft
 *  aligned without a useEffect+setState round trip (an extra commit the
 *  react-hooks/set-state-in-effect rule flags, and rightly so: this is
 *  derived from a prop, not a subscription to an external system). */
export function VerdictControls({ questionId, mine, disabled, onSave }: Props) {
  const [note, setNote] = useState(mine?.note ?? "");
  const [syncedNote, setSyncedNote] = useState(mine?.note);
  if (mine?.note !== syncedNote) {
    setSyncedNote(mine?.note);
    setNote(mine?.note ?? "");
  }
  const current: Verdict[] = mine ? [mine.verdict] : [];

  const saveNote = () => {
    if (note !== (mine?.note ?? "") && mine) onSave(questionId, mine.verdict, note);
  };

  return (
    <div className="flex flex-col gap-2">
      <ToggleGroup
        value={current}
        disabled={disabled}
        // The shadcn wrapper (components/ui/toggle-group.tsx) isn't itself
        // generic — it fixes Base UI's `ToggleGroupPrimitive.Props<Value>` at
        // its default `Value = string`, so `v` comes back untyped beyond
        // `string[]`. Every value in it did originate from a `Verdict`
        // (the only `value`s any ToggleGroupItem below is given), so the
        // narrow is safe.
        onValueChange={(v) => onSave(questionId, (v[0] as Verdict | undefined) ?? null, note)}
        aria-label={`Verdict for ${questionId}`}
      >
        {VERDICTS.map((v) => (
          <ToggleGroupItem key={v} value={v} className={`font-mono text-xs ${tone[v]}`}>
            {verdictLabel(v)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Textarea
        value={note}
        maxLength={500}
        placeholder={mine ? "Note (optional)" : "Pick a verdict to add a note"}
        disabled={disabled || !mine}
        rows={2}
        className="min-w-48 text-sm"
        onChange={(e) => setNote(e.target.value)}
        onBlur={saveNote}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") saveNote(); }}
      />
    </div>
  );
}
