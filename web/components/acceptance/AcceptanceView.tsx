"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sidebar } from "@/components/Sidebar";
import type { AppConfig } from "@/lib/types";
import type { MyVerdict, QuestionGroup, RecordedResult, RunMeta, Summary, Verdict } from "@/lib/acceptance";
import { NameGate } from "./NameGate";
import { QuestionsTab } from "./QuestionsTab";
import { ResultsTab } from "./ResultsTab";
import { SummaryTab } from "./SummaryTab";

interface Props {
  config: AppConfig | null;
  groups: QuestionGroup[];
  run: RunMeta | null;
  results: Record<string, RecordedResult>;
}

/** Mirrors NotReadyBanner.tsx's tone (hazard border/heading, muted-foreground
 *  guidance line) for the one other place this app can be unusable: the
 *  acceptance set itself failed to load. getAcceptanceQuestions() degrades to
 *  `[]` rather than throwing (lib/server.ts), so this is the only signal we
 *  get — there is no error string to surface, unlike Health. */
function QuestionsUnavailable() {
  return (
    <div role="alert" className="rounded-lg border border-hazard/40 bg-hazard/10 p-5">
      <h2 className="font-semibold text-hazard">Cannot reach the API</h2>
      <p className="mt-3 text-sm text-hazard/90">
        The acceptance question set could not be loaded from the backend.
      </p>
      <p className="mt-3 text-sm text-muted-foreground">
        Confirm the FastAPI service (uvicorn) is running, then reload this page.
      </p>
    </div>
  );
}

export function AcceptanceView({ config, groups, run, results }: Props) {
  const [name, setName] = useState<string | null>(null);
  const [mine, setMine] = useState<Record<string, MyVerdict>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState("questions");
  const total = groups.reduce((n, g) => n + g.questions.length, 0);
  const available = groups.length > 0;

  const loadMine = useCallback(async (tester: string) => {
    const r = await fetch(`/api/acceptance/verdicts?tester=${encodeURIComponent(tester)}`);
    if (r.ok) setMine((await r.json()).verdicts);
  }, []);
  const loadSummary = useCallback(async () => {
    const r = await fetch("/api/acceptance/summary");
    if (r.ok) setSummary(await r.json());
  }, []);

  // Fetch-on-mount / fetch-on-dependency-change: the standard Effect use
  // case React's own docs still endorse for data fetching absent a request
  // library (this app has none — see lib/server.ts's plain fetch + useState
  // pattern elsewhere). react-hooks/set-state-in-effect flags these because
  // it traces the setMine/setSummary call inside the (useCallback-memoized)
  // loadMine/loadSummary, but there's no framework primitive available here
  // to subscribe to instead.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (name) void loadMine(name); }, [name, loadMine]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (tab === "summary") void loadSummary(); }, [tab, loadSummary]);

  const save = useCallback(async (questionId: string, verdict: Verdict | null, note: string) => {
    if (!name) return;
    const previous = mine[questionId];
    setMine((m) => {
      const next = { ...m };
      if (verdict) next[questionId] = { verdict, note, updated_at: new Date().toISOString() };
      else delete next[questionId];
      return next;
    });
    const r = await fetch(`/api/acceptance/verdicts/${questionId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tester_name: name, verdict, note }),
    });
    if (!r.ok) {
      setMine((m) => { const next = { ...m }; if (previous) next[questionId] = previous; else delete next[questionId]; return next; });
      const detail = (await r.json().catch(() => ({})))?.detail ?? r.statusText;
      toast.error(`Could not save ${questionId}: ${detail}`);
      return;
    }
    if (summary) void loadSummary();
  }, [name, mine, summary, loadSummary]);

  const scored = Object.keys(mine).length;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <Sidebar compact config={config} topK={5} onTopK={() => {}} debug={false} onDebug={() => {}} onReset={() => {}} />
      <main className="flex-1 overflow-y-auto p-6 md:p-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-6">
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl font-medium">Acceptance testing</h1>
                <p className="text-sm text-muted-foreground">{total} questions written against the Speed WMS corpus. Score each answer against its must-contain facts.</p>
              </div>
              {available && <NameGate name={name} onName={setName} />}
            </div>
            {available && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <Progress value={total ? (scored / total) * 100 : 0} className="h-1.5 w-56" />
                <span className="font-mono">{scored}/{total} scored by you</span>
              </div>
            )}
          </header>
          {available ? (
            <Tabs value={tab} onValueChange={(v: string) => setTab(v)}>
              <TabsList>
                <TabsTrigger value="questions">Questions</TabsTrigger>
                <TabsTrigger value="results">Results</TabsTrigger>
                <TabsTrigger value="summary">Summary</TabsTrigger>
              </TabsList>
              <TabsContent value="questions"><QuestionsTab groups={groups} mine={mine} disabled={!name} onSave={save} /></TabsContent>
              <TabsContent value="results"><ResultsTab groups={groups} run={run} results={results} mine={mine} disabled={!name} onSave={save} /></TabsContent>
              <TabsContent value="summary"><SummaryTab groups={groups} summary={summary} /></TabsContent>
            </Tabs>
          ) : (
            <QuestionsUnavailable />
          )}
        </div>
      </main>
    </div>
  );
}
