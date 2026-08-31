"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sidebar } from "@/components/Sidebar";
import type { AppConfig } from "@/lib/types";
import { REVIEWER_KEY, SEEN_KEY, uid } from "@/lib/review";
import type { Annotation, GraphPoint, Patterns, ReviewRecord, Samples, Suggestion } from "@/lib/review";
import { GuideDialog } from "./GuideDialog";
import { MapView } from "./MapView";
import { ProgressView } from "./ProgressView";
import { Queue } from "./Queue";
import { RecordView } from "./RecordView";

interface Props {
  config: AppConfig | null;
  records: ReviewRecord[];
  samples: Samples;
  annotations: Annotation[];
  suggestions: Suggestion[];
  patterns: Patterns;
  graph: GraphPoint[];
}

const POLL_MS = 4000;

/** State owner for /review. The reviewer's notes are the only thing the
 *  browser writes (POST /api/review/annotations on every change, mirrored to
 *  localStorage); samples, suggestions and patterns are written by the agent
 *  from outside and polled here, with a toast when something new lands. */
export function ReviewView(initial: Props) {
  const [samples, setSamples] = useState(initial.samples);
  const [annotations, setAnnotations] = useState(initial.annotations);
  const [suggestions, setSuggestions] = useState(initial.suggestions);
  const [patterns, setPatterns] = useState(initial.patterns);
  const [who, setWho] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [tab, setTab] = useState("review");
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const byId = useMemo(() => Object.fromEntries(initial.records.map((r) => [r.id, r])), [initial.records]);
  const ids = samples.ids;
  const ready = initial.records.length > 0;

  const markSeen = useCallback((id: string) => {
    setSeen((s) => { if (s.has(id)) return s; const n = new Set(s); n.add(id); try { localStorage.setItem(SEEN_KEY, JSON.stringify([...n])); } catch {} return n; });
  }, []);

  // One-time client hydration: reviewer name, opened set, deep link. All
  // from localStorage / location, which the server render can't see, so
  // this is a sync with external state rather than derived state.
  const hydrate = useCallback(() => {
    let w = "";
    try {
      w = localStorage.getItem(REVIEWER_KEY) ?? "";
      setSeen(new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]")));
    } catch { /* private mode */ }
    setWho(w);
    if (!w) setGuideOpen(true);
    const h = location.hash.slice(1);
    const first = h && byId[h] ? h : (initial.samples.ids[0] ?? null);
    setCurrent(first);
    if (first) markSeen(first);
  }, [byId, initial.samples.ids, markSeen]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { hydrate(); }, [hydrate]);

  const go = useCallback((id: string, annId?: string) => {
    setCurrent(id); setFocusId(annId ?? null); setTab("review"); markSeen(id);
    history.replaceState(null, "", `#${id}`);
    if (!annId) window.scrollTo({ top: 0 });
  }, [markSeen]);

  // Persist annotations: debounce the POST, mirror synchronously.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback((next: Annotation[]) => {
    setAnnotations(next);
    try { localStorage.setItem("puks.review.annotations", JSON.stringify(next)); } catch {}
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const r = await fetch("/api/review/annotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) }).catch(() => null);
      if (!r?.ok) toast.error("Could not save your notes — they are kept in this browser; reload once the server is back.");
    }, 250);
  }, []);
  const persistSuggestions = useCallback((next: Suggestion[]) => {
    setSuggestions(next);
    void fetch("/api/review/suggestions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
  }, []);

  // Poll for agent-side changes.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const [s, g, p] = await Promise.all(["samples", "suggestions", "patterns"].map((k) => fetch(`/api/review/${k}`).then((r) => r.json())));
        if (!alive) return;
        setSamples((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(s)) return prev;
          const added = (s as Samples).ids.filter((i) => !prev.ids.includes(i));
          if (added.length) toast(`${added.length} new record${added.length > 1 ? "s" : ""} added to your queue: ${added.join(", ")}`);
          return s;
        });
        setSuggestions((prev) => {
          if (JSON.stringify(prev) === JSON.stringify(g)) return prev;
          const before = prev.filter((x) => x.status === "pending").length, now = (g as Suggestion[]).filter((x) => x.status === "pending").length;
          if (now > before) toast(`${now - before} new suggestion${now - before > 1 ? "s" : ""} to review — see Progress, or the purple highlights`);
          return g;
        });
        setPatterns((prev) => (JSON.stringify(prev) === JSON.stringify(p) ? prev : p));
      } catch { /* server away; keep working locally */ }
    };
    const h = setInterval(tick, POLL_MS);
    return () => { alive = false; clearInterval(h); };
  }, []);

  // Keyboard: arrows move through the queue, ? opens the guide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input, textarea") || tab !== "review" || !current) return;
      const i = ids.indexOf(current);
      if ((e.key === "ArrowRight" || e.key === "j") && i < ids.length - 1) go(ids[i + 1]);
      if ((e.key === "ArrowLeft" || e.key === "k") && i > 0) go(ids[i - 1]);
      if (e.key === "?") setGuideOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, current, tab, go]);

  const accept = useCallback((id: string) => {
    const s = suggestions.find((x) => x.id === id); if (!s) return;
    persistSuggestions(suggestions.map((x) => (x.id === id ? { ...x, status: "accepted" } : x)));
    persist([...annotations, { id: uid(), record_id: s.record_id, segment: s.segment, quote: s.quote, occ: s.occ || 0, note: s.rationale || s.mode, mode: s.mode, by: who, from_suggestion: s.id, created_at: new Date().toISOString() }]);
  }, [suggestions, annotations, who, persist, persistSuggestions]);
  const dismiss = useCallback((id: string) => persistSuggestions(suggestions.map((x) => (x.id === id ? { ...x, status: "dismissed" } : x))), [suggestions, persistSuggestions]);

  const noteCounts = useMemo(() => { const c: Record<string, number> = {}; for (const a of annotations) c[a.record_id] = (c[a.record_id] || 0) + 1; return c; }, [annotations]);
  const index = current ? ids.indexOf(current) : -1;
  const rec = current ? byId[current] : null;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar compact config={initial.config} topK={5} onTopK={() => {}} debug={false} onDebug={() => {}} onReset={() => {}} />
      {ready && (
        <div className="shrink-0 border-b border-rule md:sticky md:top-0 md:h-dvh md:w-64 md:border-r md:border-b-0">
          <Queue ids={ids} byId={byId} current={current} seen={seen} noteCounts={noteCounts} onPick={go} />
        </div>
      )}
      <main className="min-w-0 flex-1 overflow-y-auto p-6 md:p-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
        {/* Same header shape as AcceptanceView: title + one-line brief, who
         *  is working, a thin progress bar with a mono count. */}
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="font-display text-2xl font-medium">Error discovery</h1>
              <p className="text-sm text-muted-foreground">Read Puks&rsquo;s answers as the support desk would. Mark what you&rsquo;d correct; the sorting happens afterwards.</p>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Reviewing as <strong className="text-type">{who || "—"}</strong>{" "}
                <button type="button" className="underline hover:text-signal" onClick={() => setGuideOpen(true)}>change</button>
              </p>
              <Button variant="outline" size="sm" onClick={() => setGuideOpen(true)}>How to review</Button>
            </div>
          </div>
          {ready && (
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <Progress value={ids.length ? (seen.size / ids.length) * 100 : 0} className="h-1.5 w-56" />
              <span className="font-mono">{seen.size}/{ids.length} opened · {annotations.length} note{annotations.length === 1 ? "" : "s"}</span>
            </div>
          )}
        </header>

        {!ready ? (
          <div role="alert" className="rounded-lg border border-hazard/40 bg-hazard/10 p-5">
            <h2 className="font-semibold text-hazard">No review data yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">Build it from the acceptance set first: <code className="font-mono text-type">.venv/bin/python evals/error-discovery/prepare.py</code>, then reload.</p>
          </div>
        ) : (
          <Tabs value={tab} onValueChange={(v: string) => setTab(v)}>
            <TabsList>
              <TabsTrigger value="review">Review</TabsTrigger>
              <TabsTrigger value="map">Map</TabsTrigger>
              <TabsTrigger value="progress">Progress</TabsTrigger>
            </TabsList>
            <TabsContent value="review">
              {rec ? (
                <RecordView key={rec.id} record={rec} who={who}
                  annotations={annotations.filter((a) => a.record_id === rec.id)}
                  suggestions={suggestions.filter((s) => s.record_id === rec.id)}
                  index={index} total={ids.length} focusId={focusId}
                  onPrev={() => index > 0 && go(ids[index - 1])} onNext={() => index < ids.length - 1 && go(ids[index + 1])}
                  onAdd={(a) => persist([...annotations, { ...a, id: uid(), by: who, created_at: new Date().toISOString() }])}
                  onEdit={(id, note) => persist(annotations.map((a) => (a.id === id ? { ...a, note } : a)))}
                  onDelete={(id) => persist(annotations.filter((a) => a.id !== id))}
                  onAccept={accept} onDismiss={dismiss} onNeedName={() => setGuideOpen(true)} />
              ) : <p className="text-sm text-muted-foreground">Pick a record from the queue.</p>}
            </TabsContent>
            <TabsContent value="map">
              <MapView graph={initial.graph} byId={byId} sampleIds={new Set(ids)} annotatedIds={new Set(annotations.map((a) => a.record_id))} onPick={go} />
            </TabsContent>
            <TabsContent value="progress">
              <ProgressView seenCount={seen.size} queueCount={ids.length} annotations={annotations} patterns={patterns} suggestions={suggestions} onOpen={go}
                onBulk={(sel, status) => { for (const id of sel) { if (status === "accepted") accept(id); else dismiss(id); } toast(`${sel.length} suggestion${sel.length > 1 ? "s" : ""} ${status}`); }} />
            </TabsContent>
          </Tabs>
        )}
        </div>
      </main>

      <GuideDialog key={guideOpen ? "open" : "closed"} open={guideOpen} name={who} onClose={(n) => { setWho(n); try { localStorage.setItem(REVIEWER_KEY, n); } catch {} setGuideOpen(false); }} />
    </div>
  );
}
