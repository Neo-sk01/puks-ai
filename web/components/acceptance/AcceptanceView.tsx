"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppShell } from "@/components/shell/AppShell";
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
    <div role="alert" className="flex items-start gap-3 rounded-2xl border border-hazard/40 bg-hazard/10 p-5">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-hazard/15 text-hazard">
        <TriangleAlert className="size-5" aria-hidden="true" />
      </span>
      <div>
        <h2 className="font-display text-lg font-semibold text-hazard">Cannot reach the API</h2>
        <p className="mt-2 text-sm text-hazard/90">
          The acceptance question set could not be loaded from the backend.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Confirm the FastAPI service (uvicorn) is running, then reload this page.
        </p>
      </div>
    </div>
  );
}

export function AcceptanceView({ config, groups, run, results }: Props) {
  const [name, setName] = useState<string | null>(null);
  const [mine, setMine] = useState<Record<string, MyVerdict>>({});
  const [mineLoadFailed, setMineLoadFailed] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tab, setTab] = useState("questions");
  const total = groups.reduce((n, g) => n + g.questions.length, 0);
  const available = groups.length > 0;

  const loadMine = useCallback(async (tester: string) => {
    try {
      const r = await fetch(`/api/acceptance/verdicts?tester=${encodeURIComponent(tester)}`);
      if (r.ok) {
        setMine((await r.json()).verdicts);
        setMineLoadFailed(false);
      } else {
        setMineLoadFailed(true);
        toast.error("Could not load your saved verdicts — reload the page before scoring, or you may overwrite them.");
      }
    } catch {
      setMineLoadFailed(true);
      toast.error("Could not load your saved verdicts — reload the page before scoring, or you may overwrite them.");
    }
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
  useEffect(() => { if (name) { setMine({}); setMineLoadFailed(false); void loadMine(name); } }, [name, loadMine]);
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
    const r = await fetch(`/api/acceptance/verdicts/${encodeURIComponent(questionId)}`, {
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
  const percent = total ? Math.round((scored / total) * 100) : 0;

  return (
    <AppShell config={config}>
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-8 md:px-8 md:py-10">
        <header className="flex flex-col gap-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-xl">
              <h1 className="font-display text-3xl font-semibold tracking-tight">Acceptance testing</h1>
              <p className="mt-2 text-muted-foreground">
                {total} questions written against the Speed WMS corpus. Score each answer against its must-contain facts.
              </p>
            </div>
            {available && <NameGate name={name} onName={setName} />}
          </div>

          {available && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-rule bg-card p-4 shadow-soft">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl font-semibold tabular-nums">{scored}</span>
                <span className="text-sm text-muted-foreground">
                  {mineLoadFailed ? "couldn't load your verdicts" : `of ${total} scored by you`}
                </span>
              </div>
              <Progress
                value={total ? (scored / total) * 100 : 0}
                aria-label="Your scoring progress"
                className="min-w-40 flex-1"
              />
              <span className="font-mono text-sm text-muted-foreground tabular-nums">{percent}%</span>
            </div>
          )}
        </header>

        {available ? (
          <Tabs value={tab} onValueChange={(v: string) => setTab(v)} className="gap-6">
            <TabsList className="group-data-horizontal/tabs:h-10 p-1">
              <TabsTrigger value="questions" className="px-4">Questions</TabsTrigger>
              <TabsTrigger value="results" className="px-4">Results</TabsTrigger>
              <TabsTrigger value="summary" className="px-4">Summary</TabsTrigger>
            </TabsList>
            <TabsContent value="questions"><QuestionsTab groups={groups} mine={mine} disabled={!name} onSave={save} /></TabsContent>
            <TabsContent value="results"><ResultsTab groups={groups} run={run} results={results} mine={mine} disabled={!name} onSave={save} /></TabsContent>
            <TabsContent value="summary"><SummaryTab groups={groups} summary={summary} /></TabsContent>
          </Tabs>
        ) : (
          <QuestionsUnavailable />
        )}
      </div>
    </AppShell>
  );
}
