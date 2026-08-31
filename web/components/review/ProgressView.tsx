"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Annotation, Patterns, Suggestion } from "@/lib/review";

interface Props {
  seenCount: number;
  queueCount: number;
  annotations: Annotation[];
  patterns: Patterns;
  suggestions: Suggestion[];
  onOpen: (recordId: string, annId?: string) => void;
  onBulk: (ids: string[], status: "accepted" | "dismissed") => void;
}

/** Laid out like SummaryTab: a stats strip, then sections with hairline
 *  headers. Failure modes are the taxonomy the agent built from the notes,
 *  each with its notes as links back to the spot; suggestions are the
 *  agent's proposed instances waiting for accept/dismiss, in a table with
 *  select-all so "accept all but these two" is three clicks. */
export function ProgressView({ seenCount, queueCount, annotations, patterns, suggestions, onOpen, onBulk }: Props) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const pending = suggestions.filter((s) => s.status === "pending");
  const withNotes = new Set(annotations.map((a) => a.record_id)).size;
  const modes = Object.entries(patterns).sort((a, b) => (b[1].count || 0) - (a[1].count || 0));
  const allChecked = pending.length > 0 && pending.every((s) => checked.has(s.id));
  const bulk = (status: "accepted" | "dismissed") => {
    const ids = pending.filter((s) => checked.has(s.id)).map((s) => s.id);
    if (!ids.length) return;
    onBulk(ids, status);
    setChecked(new Set());
  };

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-center gap-4 rounded border border-rule bg-bay px-3 py-2 font-mono text-xs text-muted-foreground">
        <span><strong className="text-type">{seenCount}</strong>/{queueCount} opened</span>
        <span><strong className="text-type">{withNotes}</strong> with notes</span>
        <span><strong className="text-type">{annotations.length}</strong> notes</span>
        <span><strong className="text-type">{modes.length}</strong> failure modes</span>
        <span><strong className="text-type">{pending.length}</strong> suggestions waiting</span>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-3 border-b border-rule pb-2">
          <h2 className="font-display text-xl font-medium">Failure modes</h2>
          <p className="text-sm text-muted-foreground">Grouped from your notes as you go — usually after the first five or six.</p>
        </div>
        {!modes.length && <p className="text-sm text-muted-foreground">None yet.</p>}
        {modes.map(([name, m]) => {
          const ids = new Set(m.annotation_ids ?? []);
          const notes = annotations.filter((a) => ids.has(a.id) || (a.mode === name && (m.example_ids ?? []).includes(a.record_id)));
          return (
            <div key={name} className="grid gap-4 py-3 lg:grid-cols-[16rem_1fr]">
              <div>
                <p className="font-medium">{name}</p>
                <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{m.count || 0} note{m.count === 1 ? "" : "s"}</p>
              </div>
              <div className="flex flex-col divide-y divide-rule border-y border-rule">
                {notes.slice(0, 12).map((a) => (
                  <button key={a.id} type="button" onClick={() => onOpen(a.record_id, a.id)} title={a.quote}
                    className="grid grid-cols-[3.5rem_1fr] gap-4 py-2 text-left text-sm hover:bg-bay">
                    <span className="font-mono text-xs text-signal">{a.record_id}</span>
                    <span className="min-w-0">{a.note}</span>
                  </button>
                ))}
                {!notes.length && <p className="py-2 text-sm text-muted-foreground">{(m.example_ids ?? []).join(", ")}</p>}
              </div>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border-b border-rule pb-2">
          <h2 className="font-display text-xl font-medium">Suggestions</h2>
          <p className="text-sm text-muted-foreground">Found automatically once a failure mode is known. Accept if you agree; dismissing costs nothing.</p>
          <span className="ml-auto flex gap-1">
            <Button size="sm" onClick={() => bulk("accepted")} disabled={!checked.size}>Accept selected</Button>
            <Button size="sm" variant="outline" onClick={() => bulk("dismissed")} disabled={!checked.size}>Dismiss selected</Button>
          </span>
        </div>
        {!pending.length ? (
          <p className="text-sm text-muted-foreground">Nothing waiting.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"><Checkbox checked={allChecked} aria-label="Select all" onCheckedChange={(v) => setChecked(v ? new Set(pending.map((s) => s.id)) : new Set())} /></TableHead>
                <TableHead className="w-14">ID</TableHead>
                <TableHead className="w-44">Mode</TableHead>
                <TableHead>Quoted text</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((s) => (
                <TableRow key={s.id}>
                  <TableCell><Checkbox checked={checked.has(s.id)} aria-label={`Select ${s.id}`} onCheckedChange={(v) => setChecked((c) => { const n = new Set(c); if (v) n.add(s.id); else n.delete(s.id); return n; })} /></TableCell>
                  <TableCell className="font-mono text-xs text-signal">{s.record_id}</TableCell>
                  <TableCell className="whitespace-normal text-sm">{s.mode}</TableCell>
                  <TableCell className="whitespace-normal">
                    <button type="button" className="text-left text-sm hover:text-signal hover:underline" onClick={() => onOpen(s.record_id, s.id)}>&ldquo;{s.quote}&rdquo;</button>
                    {s.rationale && <p className="text-xs text-muted-foreground">{s.rationale}</p>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
