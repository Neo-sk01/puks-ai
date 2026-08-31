"use client";

import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import type { Annotation, ReviewRecord, Segment, Suggestion } from "@/lib/review";
import { findRange, occurrenceBefore, unwrap, wrapRange } from "./highlight";

interface Props {
  record: ReviewRecord;
  annotations: Annotation[];
  suggestions: Suggestion[];
  who: string;
  index: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onAdd: (a: Omit<Annotation, "id" | "by" | "created_at">) => void;
  onEdit: (id: string, note: string) => void;
  onDelete: (id: string) => void;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onNeedName: () => void;
  /** Optional annotation to scroll to and outline on mount (from Progress). */
  focusId?: string | null;
}

/** Highlight tones follow the acceptance page's palette: the reviewer's own
 *  marks in the brand yellow tint, the agent's suggestions in signal blue —
 *  dashed, because they are proposals — and the in-progress selection in
 *  between the two. */
const MARK = {
  hl: "review-mark bg-agl-yellow-70 border-b-2 border-brand cursor-pointer text-inherit",
  pending: "review-mark bg-agl-yellow-50 border-b-2 border-dashed border-signal text-inherit",
  sug: "review-mark bg-signal/10 border-b-2 border-dashed border-signal cursor-pointer text-inherit",
};

const statusLabel: Record<string, string> = {
  answered: "Answered", gated: "Gated refusal", self: "Self-description", "needs-context": "Asked for context", error: "Error",
};
function status(r: ReviewRecord) {
  if (r.error) return "error";
  if (r.refused) return "gated";
  if (r.reason === "self_description") return "self";
  if (r.reason === "needs_context") return "needs-context";
  return "answered";
}

/** One record, laid out as a ResultsTab row (components/acceptance/ResultsTab.tsx):
 *  id column, then question → must-contain → source → meta line → the answer
 *  in the one boxed element on the page → source excerpts. Inline highlights
 *  and the margin column of notes are layered on top. The segment content is
 *  rendered once per record (RecordBody is memoised on the id) so the
 *  highlight code can split and wrap its text nodes without React
 *  reconciling them away. */
export function RecordView(p: Props) {
  const articleRef = useRef<HTMLDivElement>(null);
  const marginRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [tick, setTick] = useState(0);
  const [pop, setPop] = useState<{ quote: string; occ: number; segment: Segment; top: number; left: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const relayout = useCallback(() => setTick((t) => t + 1), []);

  useLayoutEffect(() => {
    const art = articleRef.current, mg = marginRef.current;
    if (!art || !mg) return;
    unwrap(art, "mark.review-mark:not(.pending-keep)");
    const items = [
      ...p.annotations.map((a) => ({ ...a, cls: MARK.hl })),
      ...p.suggestions.filter((s) => s.status === "pending").map((s) => ({ ...s, cls: MARK.sug })),
    ];
    for (const it of items) {
      const seg = art.querySelector<HTMLElement>(`[data-seg="${it.segment}"]`);
      if (!seg) continue;
      const rg = findRange(seg, it.quote, it.occ || 0);
      if (!rg) continue;
      for (const m of wrapRange(rg, it.cls, { ann: it.id })) {
        m.addEventListener("mouseenter", () => link(it.id, true));
        m.addEventListener("mouseleave", () => link(it.id, false));
        m.addEventListener("click", () => mg.querySelector(`[data-note="${it.id}"]`)?.scrollIntoView({ block: "nearest" }));
      }
    }
    const mtop = mg.getBoundingClientRect().top;
    const next: Record<string, number> = {};
    for (const it of items) {
      const m = art.querySelector<HTMLElement>(`mark[data-ann="${it.id}"]`);
      if (m) next[it.id] = m.getBoundingClientRect().top - mtop;
    }
    setPositions(next);
    if (p.focusId) {
      const m = art.querySelector<HTMLElement>(`mark[data-ann="${p.focusId}"]`);
      if (m) { m.scrollIntoView({ block: "center" }); link(p.focusId, true); }
    }
  }, [p.annotations, p.suggestions, p.record.id, p.focusId, tick]);

  // Stack the margin notes so none overlap: each sits at its anchor unless
  // the note above runs into it. Measured heights, written straight to the
  // DOM — this is layout, not state.
  useLayoutEffect(() => {
    const mg = marginRef.current;
    if (!mg) return;
    const notes = Array.from(mg.querySelectorAll<HTMLElement>("[data-note]"))
      .map((el) => ({ el, anchor: positions[el.dataset.note!] ?? 0 }))
      .sort((a, b) => a.anchor - b.anchor);
    let cursor = 0;
    for (const { el, anchor } of notes) {
      const top = Math.max(anchor, cursor);
      el.style.top = `${top}px`;
      cursor = top + el.offsetHeight + 8;
    }
    mg.style.minHeight = `${cursor}px`;
  }, [positions, editing]);

  useLayoutEffect(() => {
    window.addEventListener("resize", relayout);
    return () => window.removeEventListener("resize", relayout);
  }, [relayout]);

  const onMouseUp = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-pop]")) return;
    if (pop) closePop();
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const rg = sel.getRangeAt(0);
    const quote = sel.toString().trim();
    if (quote.length < 2) return;
    const start = rg.commonAncestorContainer;
    const segEl = (start.nodeType === Node.TEXT_NODE ? start.parentElement : (start as Element))?.closest<HTMLElement>("[data-seg]");
    if (!segEl || !articleRef.current?.contains(segEl)) return;
    if (!p.who) { p.onNeedName(); return; }
    const occ = occurrenceBefore(segEl, rg, quote);
    const rect = rg.getBoundingClientRect(), host = articleRef.current.getBoundingClientRect();
    wrapRange(rg, MARK.pending + " pending-keep");
    sel.removeAllRanges();
    setPop({ quote, occ, segment: segEl.dataset.seg as Segment, top: rect.bottom - host.top + 6, left: Math.max(0, Math.min(rect.left - host.left, host.width - 330)) });
  };
  const closePop = () => { if (articleRef.current) unwrap(articleRef.current, "mark.pending-keep"); setPop(null); };
  const savePop = (note: string) => {
    if (!pop || !note.trim()) return;
    p.onAdd({ record_id: p.record.id, segment: pop.segment, quote: pop.quote, occ: pop.occ, note: note.trim() });
    closePop();
  };

  const r = p.record;
  const noteItems = [
    ...p.annotations.map((a) => ({ kind: "ann" as const, a })),
    ...p.suggestions.filter((s) => s.status === "pending").map((s) => ({ kind: "sug" as const, s })),
  ].map((it) => ({ ...it, id: it.kind === "ann" ? it.a.id : it.s.id }))
   .filter((it) => positions[it.id] != null)
   .sort((x, y) => positions[x.id] - positions[y.id]);

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_16rem]">
      <div ref={articleRef} className="relative min-w-0" onMouseUp={onMouseUp}>
        {/* Group header, as QuestionsTab renders it — plus the outlier flags,
         *  in the same outline-badge tone the summary uses for "disagree". */}
        <div className="flex flex-wrap items-baseline gap-3 border-b border-rule pb-2">
          <h2 className="font-display text-xl font-medium">{r.group_title}</h2>
          <span className="rounded bg-signal/10 px-1.5 font-mono text-xs text-signal">{r.group}</span>
          {r.flags.map((f) => <Badge key={f} variant="outline" className="border-verdict-partial font-mono text-verdict-partial">{f}</Badge>)}
          <nav className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={p.onPrev} disabled={p.index <= 0}>← Prev</Button>
            <span className="font-mono text-xs text-muted-foreground">{p.index + 1}/{p.total}</span>
            <Button size="sm" variant="outline" onClick={p.onNext} disabled={p.index >= p.total - 1}>Next →</Button>
          </nav>
        </div>

        <RecordBody record={r} onLayout={relayout} />

        {pop && (
          <div data-pop className="absolute z-40 w-[330px] rounded border border-rule bg-ink p-2 shadow-md" style={{ top: pop.top, left: pop.left }}>
            <p className="mb-1 truncate font-mono text-xs text-muted-foreground" title={pop.quote}>&ldquo;{pop.quote}&rdquo;</p>
            <PopTextarea onSave={savePop} onCancel={closePop} />
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">Enter saves · Esc cancels</p>
          </div>
        )}
      </div>

      <div ref={marginRef} className="relative hidden min-h-full xl:block">
        {noteItems.map((it) => (
          <MarginNote key={it.id} top={positions[it.id]} it={it} editing={editing === it.id}
            onLink={(on) => link(it.id, on)}
            onEdit={() => setEditing(it.id)} onEdited={(note) => { p.onEdit(it.id, note); setEditing(null); }}
            onDelete={() => p.onDelete(it.id)} onAccept={() => p.onAccept(it.id)} onDismiss={() => p.onDismiss(it.id)} />
        ))}
      </div>
    </div>
  );
}

function link(id: string, on: boolean) {
  document.querySelectorAll(`[data-ann="${id}"], [data-note="${id}"]`).forEach((n) => { n.classList.toggle("ring-2", on); n.classList.toggle("ring-signal", on); });
}

function PopTextarea({ onSave, onCancel }: { onSave: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState("");
  return (
    <>
      <Textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} rows={3} className="text-sm" placeholder="What is wrong here, in your words?"
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSave(v); } if (e.key === "Escape") onCancel(); }} />
      <div className="mt-1.5 flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" onClick={() => onSave(v)} disabled={!v.trim()}>Save note</Button>
      </div>
    </>
  );
}

type NoteItem = { kind: "ann"; a: Annotation; id: string } | { kind: "sug"; s: Suggestion; id: string };

function MarginNote({ top, it, editing, onLink, onEdit, onEdited, onDelete, onAccept, onDismiss }: {
  top: number; it: NoteItem; editing: boolean; onLink: (on: boolean) => void; onEdit: () => void; onEdited: (note: string) => void;
  onDelete: () => void; onAccept: () => void; onDismiss: () => void;
}) {
  const agent = it.kind === "sug";
  const [draft, setDraft] = useState(it.kind === "ann" ? it.a.note : "");
  const quote = it.kind === "ann" ? it.a.quote : it.s.quote;
  return (
    <div data-note={it.id} onMouseEnter={() => onLink(true)} onMouseLeave={() => onLink(false)}
      className={cn("group absolute inset-x-0 rounded border px-3 py-2 text-xs transition-[top]", agent ? "border-signal/40 bg-signal/5" : "border-rule bg-bay")} style={{ top }}>
      {agent && <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-signal">suggestion · {it.s.mode}</p>}
      <p className="truncate font-mono text-[11px] text-muted-foreground" title={quote}>&ldquo;{quote}&rdquo;</p>
      {it.kind === "ann" ? (
        editing ? (
          <Textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} className="mt-1 text-xs"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEdited(draft.trim() || it.a.note); } if (e.key === "Escape") onEdited(it.a.note); }}
            onBlur={() => onEdited(draft.trim() || it.a.note)} />
        ) : (
          <>
            <p className="mt-0.5 whitespace-pre-wrap text-sm">{it.a.note}</p>
            <p className="mt-1 font-mono text-[10px] text-muted-foreground">{it.a.by}{it.a.mode ? ` · ${it.a.mode}` : ""}</p>
            <div className="mt-1 hidden gap-1 group-hover:flex group-focus-within:flex">
              <Button size="xs" variant="outline" onClick={onEdit}>Edit</Button>
              <Button size="xs" variant="outline" onClick={() => { if (confirm("Delete this note?")) onDelete(); }}>Delete</Button>
            </div>
          </>
        )
      ) : (
        <>
          {it.s.rationale && <p className="mt-0.5 text-sm">{it.s.rationale}</p>}
          <div className="mt-1.5 flex gap-1">
            <Button size="xs" onClick={onAccept}>Accept</Button>
            <Button size="xs" variant="outline" onClick={onDismiss}>Dismiss</Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── the record, rendered once ────────────────────────────────────────── */

const RecordBody = memo(function RecordBody({ record: r, onLayout }: { record: ReviewRecord; onLayout: () => void }) {
  const conf = r.confidence, thr = r.threshold ?? 0.75;
  const declined = r.refused || !r.answer;
  const st = status(r);
  return (
    <article className="grid gap-4 py-4 lg:grid-cols-[3.5rem_1fr]">
      <span className={cn("font-mono text-xs", r.kind === "refuse" ? "text-hazard" : "text-signal")}>{r.id}</span>
      <div className="min-w-0">
        <div data-seg="question">
          <p className="font-medium">{r.question}</p>
          {r.asked.length > 1 && <ol className="mt-1 list-decimal pl-5 text-sm text-muted-foreground">{r.asked.map((a) => <li key={a}>{a}</li>)}</ol>}
        </div>

        <div data-seg="key" className="mt-1 text-sm text-muted-foreground">
          <Markdown>{r.must_contain}</Markdown>
          {r.expected_source && <p className="mt-1 break-words font-mono text-xs">{r.expected_source}</p>}
        </div>

        <div data-seg="retrieval" className="mt-2 flex flex-wrap items-center gap-3 font-mono text-xs text-muted-foreground">
          <Badge variant={st === "answered" || st === "self" ? "secondary" : "outline"}>{statusLabel[st]}</Badge>
          {conf != null && (
            <span>relevance <strong className={conf >= thr ? "text-type" : "text-hazard"}>{conf.toFixed(3)}</strong>{conf < thr && ` · below the ${thr} gate`}</span>
          )}
          <span>{r.elapsed_s}s</span>
          {r.top_source && (
            <span className="min-w-0 break-words">
              top: {r.top_source}
              {r.source_match === true && <span className="ml-1.5 text-verdict-pass">✓ expected</span>}
              {r.source_match === false && <span className="ml-1.5 text-verdict-fail">✗ expected {r.expected_source}</span>}
            </span>
          )}
        </div>

        <div data-seg="answer" className={cn("mt-2 rounded border px-4 py-3 text-sm", declined ? "border-hazard/40 bg-hazard/10" : "border-rule bg-bay")}>
          {declined ? (
            <>
              <p className="font-medium text-hazard">
                {r.reason === "needs_context" ? "Puks asked what the question referred to, rather than answering."
                  : r.reason === "self_description" ? "Puks answered with its capabilities description (no retrieval)."
                  : "“I do not have enough information to answer this. Please contact support.”"}
              </p>
              {r.answer && <div className="mt-2"><Markdown>{r.answer}</Markdown></div>}
            </>
          ) : <Markdown>{r.answer}</Markdown>}
        </div>

        {r.sources.length > 0 && (
          <p className="mt-1 break-words font-mono text-xs text-muted-foreground">retrieved: {r.sources.slice(0, 5).join(" · ")}</p>
        )}

        <div data-seg="sources" className="mt-4">
          <p className="pb-1 font-display text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Source excerpts — what those documents say</p>
          <div className="divide-y divide-rule border-y border-rule">
            {!r.excerpts.length && <p className="py-2 text-sm text-muted-foreground">Nothing was retrieved for this question.</p>}
            {r.excerpts.map((x) => (
              <Collapsible key={x.source_file} onOpenChange={() => requestAnimationFrame(onLayout)}>
                <CollapsibleTrigger className="flex w-full items-center gap-3 py-2 text-left font-mono text-xs hover:text-signal">
                  <span className={cn(x.is_top ? "text-type" : "text-muted-foreground")}>{x.is_top ? "▲ " : ""}{x.source_file}</span>
                  <span className="ml-auto text-muted-foreground">{x.category ?? ""} · {x.n_chunks} passage{x.n_chunks === 1 ? "" : "s"}</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="pb-3">
                  {x.chunks.map((c, i) => (
                    <div key={i} className="mt-1 rounded border border-rule bg-bay px-4 py-3 text-sm whitespace-pre-wrap">
                      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{c.chunk_type ?? ""}</span>{c.text}
                    </div>
                  ))}
                  {x.n_chunks > x.chunks.length && <p className="mt-1 font-mono text-xs text-muted-foreground">… {x.n_chunks - x.chunks.length} more passage(s) in this document not shown</p>}
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}, (a, b) => a.record.id === b.record.id);
