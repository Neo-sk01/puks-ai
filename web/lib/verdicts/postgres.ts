import "server-only";
import { Pool } from "pg";
import type { MyVerdict, Verdict } from "../acceptance";
import { aggregateSummary, normaliseTester, toPythonIsoString, type VerdictRow } from "./shared";
import type { RemoveResult, UpsertResult, VerdictsStore } from "./types";

/** Mirrors api/acceptance_store.py's _SCHEMA / CREATE TABLE IF NOT EXISTS,
 *  field for field. No FK on question_id — the SQLite version doesn't have
 *  one either; question ids are validated against the bundled JSON by the
 *  route handler before this module ever sees them. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS verdict (
  question_id text NOT NULL,
  tester text NOT NULL,
  tester_name text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('pass','partial','fail')),
  note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, tester)
);
`;

/**
 * One pooled client per process, reused across serverless invocations via
 * globalThis — a fresh Pool per request would exhaust Postgres' connection
 * limit the moment more than a couple of testers score at once, and Vercel
 * can freeze/thaw a function instance between requests rather than
 * recreating the module from scratch. Stashing it on globalThis is the
 * standard way to survive that (and Next dev's module-reload churn, though
 * that's moot here — this file only does anything when POSTGRES_URL /
 * DATABASE_URL is set; see lib/deployment.ts).
 */
const globalForPg = globalThis as unknown as { puksAcceptancePool?: Pool };

function pool(): Pool {
  if (!globalForPg.puksAcceptancePool) {
    globalForPg.puksAcceptancePool = new Pool({
      connectionString: process.env.POSTGRES_URL ?? process.env.DATABASE_URL,
      max: 5,
    });
  }
  return globalForPg.puksAcceptancePool;
}

let schemaReady: Promise<void> | null = null;

/** CREATE TABLE IF NOT EXISTS on first use rather than a migration step —
 *  there's no migration runner in this deploy, and the statement is
 *  idempotent, so doing it lazily on the first query means "set
 *  POSTGRES_URL" is the entire provisioning story. Memoised so every
 *  invocation after the first skips straight to the real query. */
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null; // let the next call retry instead of caching a failure forever
        throw error;
      });
  }
  return schemaReady;
}

export const postgresStore: VerdictsStore = {
  async forTester(tester) {
    await ensureSchema();
    const key = normaliseTester(tester);
    const { rows } = await pool().query<{ question_id: string; verdict: Verdict; note: string; updated_at: Date }>(
      "SELECT question_id, verdict, note, updated_at FROM verdict WHERE tester = $1",
      [key],
    );
    const out: Record<string, MyVerdict> = {};
    for (const r of rows) {
      out[r.question_id] = { verdict: r.verdict, note: r.note, updated_at: toPythonIsoString(r.updated_at) };
    }
    return out;
  },

  async upsert(questionId, testerName, verdict, note): Promise<UpsertResult> {
    await ensureSchema();
    const key = normaliseTester(testerName);
    const name = testerName.trim();
    const { rows } = await pool().query<{ tester_name: string; verdict: Verdict; note: string; updated_at: Date }>(
      `INSERT INTO verdict (question_id, tester, tester_name, verdict, note, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (question_id, tester) DO UPDATE SET
         tester_name = EXCLUDED.tester_name,
         verdict = EXCLUDED.verdict,
         note = EXCLUDED.note,
         updated_at = now()
       RETURNING tester_name, verdict, note, updated_at`,
      [questionId, key, name, verdict, note],
    );
    const row = rows[0];
    return {
      question_id: questionId,
      tester: key,
      tester_name: row.tester_name,
      verdict: row.verdict,
      note: row.note,
      updated_at: toPythonIsoString(row.updated_at),
    };
  },

  async remove(questionId, testerName): Promise<RemoveResult> {
    await ensureSchema();
    const key = normaliseTester(testerName);
    await pool().query("DELETE FROM verdict WHERE question_id = $1 AND tester = $2", [questionId, key]);
    return { question_id: questionId, tester: key, verdict: null };
  },

  async summary(questionIds) {
    await ensureSchema();
    const { rows } = await pool().query<VerdictRow>(
      "SELECT question_id, tester, tester_name, verdict FROM verdict ORDER BY tester_name",
    );
    return aggregateSummary(rows, questionIds);
  },
};
