import type { MyVerdict, Summary, Verdict } from "../acceptance";

/**
 * Thrown by both implementations to signal "relay this status and detail to
 * the client verbatim" — the shape FastAPI's own HTTPException produces
 * ({ detail }). Route handlers catch this once and turn it into the
 * matching NextResponse, so neither implementation touches Response/
 * NextResponse itself.
 */
export class HttpError extends Error {
  status: number;
  detail: string;

  constructor(status: number, detail: string) {
    super(detail);
    this.name = "HttpError";
    this.status = status;
    this.detail = detail;
  }
}

export interface UpsertResult {
  question_id: string;
  tester: string;
  tester_name: string;
  verdict: Verdict;
  note: string;
  updated_at: string;
}

export interface RemoveResult {
  question_id: string;
  tester: string;
  verdict: null;
}

/**
 * The seam between the route handlers and wherever verdicts actually live.
 * Mirrors api/acceptance_store.py's Store: forTester ~ for_tester, upsert ~
 * upsert, remove ~ delete (but returns the same { question_id, tester,
 * verdict: null } shape api/acceptance.py's put_verdict route builds after
 * calling delete, since that shape is deterministic from the inputs alone),
 * summary ~ summary.
 *
 * Two implementations: postgres.ts (Vercel, no Python) and proxy.ts (every
 * other deploy, including local dev) — see index.ts for how one is chosen.
 */
export interface VerdictsStore {
  forTester(tester: string): Promise<Record<string, MyVerdict>>;
  upsert(questionId: string, testerName: string, verdict: Verdict, note: string): Promise<UpsertResult>;
  remove(questionId: string, testerName: string): Promise<RemoveResult>;
  summary(questionIds: string[]): Promise<Summary>;
}
