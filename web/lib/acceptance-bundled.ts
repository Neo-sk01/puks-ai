import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AcceptanceQuestion, QuestionGroup, RecordedResult, RunMeta } from "./acceptance";

/**
 * Reads the acceptance data set bundled into the deploy by
 * scripts/prebuild-acceptance-data.js (see package.json's "prebuild" script
 * and next.config.ts's outputFileTracingIncludes, which makes sure Vercel
 * ships this directory inside the functions that read it). Used only when
 * lib/deployment.ts's STANDALONE is true — there is no FastAPI service to
 * proxy to, so questions/results have to come from the bundle instead.
 *
 * In local development this directory does not exist — prebuild only runs
 * before `next build`, never `next dev` — but that's fine: every reader
 * here degrades to an empty/null result rather than throwing, the same
 * degrade-on-missing-file style getAcceptanceQuestions/getAcceptanceResults
 * already use in ./server.ts for the proxy path, and callers only reach
 * this module at all when STANDALONE (which is never true locally).
 */

const DATA_DIR = path.join(process.cwd(), "data", "acceptance");
const GROUP_ORDER = "ROLSMGDTXCN";

interface RawQuestion extends AcceptanceQuestion {
  group: string;
  group_title: string;
  group_note: string;
}

function readJson<T>(name: string, fallback: T): T {
  const file = path.join(DATA_DIR, name);
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

let cachedQuestions: RawQuestion[] | null = null;

function rawQuestions(): RawQuestion[] {
  if (!cachedQuestions) cachedQuestions = readJson<RawQuestion[]>("acceptance-questions.json", []);
  return cachedQuestions;
}

/** Mirrors GET /api/acceptance/questions's grouping in api/acceptance.py:
 *  group by first appearance, keep only the question fields the API
 *  exposes, then order groups by GROUP_ORDER. */
export function bundledQuestionGroups(): QuestionGroup[] {
  const groups = new Map<string, QuestionGroup>();
  for (const q of rawQuestions()) {
    let g = groups.get(q.group);
    if (!g) {
      g = { key: q.group, title: q.group_title, note: q.group_note, questions: [] };
      groups.set(q.group, g);
    }
    g.questions.push({
      id: q.id, question: q.question, asked: q.asked, must_contain: q.must_contain, source: q.source, kind: q.kind,
    });
  }
  return [...GROUP_ORDER].filter((k) => groups.has(k)).map((k) => groups.get(k)!);
}

export function bundledQuestionIds(): Set<string> {
  return new Set(rawQuestions().map((q) => q.id));
}

/** Mirrors GET /api/acceptance/results in api/acceptance.py: `run: null`
 *  and `results: {}` when the files are missing, keyed by result id
 *  otherwise. */
export function bundledResults(): { run: RunMeta | null; results: Record<string, RecordedResult> } {
  const rows = readJson<RecordedResult[]>("acceptance-results.json", []);
  const run = readJson<RunMeta | null>("acceptance-run.json", null);
  const results: Record<string, RecordedResult> = {};
  for (const r of rows) results[r.id] = r;
  return { run, results };
}
