import "server-only";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { STANDALONE } from "./deployment";

/**
 * Store for the review tool: six JSON documents, each read and replaced
 * whole. Where they live depends on the deploy, decided by the same
 * STANDALONE flag the verdicts store keys on (lib/deployment.ts):
 *
 *  - Local development: files under evals/error-discovery/data (one
 *    directory up from web/) — the same files prepare.py writes and the
 *    agent reads, so a reviewer's notes are plain files in the repo.
 *    Writes go through a temp file + rename (atomic on POSIX), which keeps
 *    an agent-side reader from ever seeing a half-written annotations.json.
 *
 *  - Standalone (Vercel, POSTGRES_URL/DATABASE_URL set): the three
 *    prepare.py-derived documents (records, graph, samples) are bundled
 *    read-only into the deploy by scripts/prebuild-review-data.mjs, and
 *    the mutable documents (annotations, suggestions, patterns — plus any
 *    agent-pushed samples override) live in one Postgres table,
 *    review_doc(key, value), because a serverless filesystem forgets
 *    every write.
 *
 * PUKS_REVIEW_DATA overrides the local directory (tests point it at a
 * temp dir); PUKS_REVIEW_BUNDLED overrides the bundled one.
 */

export const REVIEW_KEYS = ["records", "samples", "annotations", "graph", "patterns", "suggestions"] as const;
export type ReviewKey = (typeof REVIEW_KEYS)[number];
export const WRITABLE_KEYS: ReadonlySet<ReviewKey> = new Set<ReviewKey>(["samples", "annotations", "patterns", "suggestions"]);
/** Derived by prepare.py, bundled into the deploy, never written at runtime. */
const BUNDLED_KEYS: ReadonlySet<ReviewKey> = new Set<ReviewKey>(["records", "graph", "samples"]);

const EMPTY: Record<ReviewKey, unknown> = {
  records: [], samples: { ids: [] }, annotations: [], graph: [], patterns: {}, suggestions: [],
};

export function isReviewKey(key: string): key is ReviewKey {
  return (REVIEW_KEYS as readonly string[]).includes(key);
}

export function dataDir(): string {
  return process.env.PUKS_REVIEW_DATA ?? path.resolve(process.cwd(), "..", "evals", "error-discovery", "data");
}

function bundledDir(): string {
  return process.env.PUKS_REVIEW_BUNDLED ?? path.join(process.cwd(), "data", "review");
}

function readJsonFile<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

/* ── Postgres document store (standalone deploys only) ─────────────────── */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS review_doc (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

/** Same globalThis-pooling shape as lib/verdicts/postgres.ts, and for the
 *  same reason: one Pool per process, surviving Vercel's freeze/thaw. A
 *  separate pool from the verdicts one only because the two stores are
 *  independently usable; both stay well under the connection budget. */
const globalForPg = globalThis as unknown as { puksReviewPool?: Pool };

function pool(): Pool {
  if (!globalForPg.puksReviewPool) {
    globalForPg.puksReviewPool = new Pool({
      connectionString: process.env.POSTGRES_URL ?? process.env.DATABASE_URL,
      max: 3,
    });
  }
  return globalForPg.puksReviewPool;
}

let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = pool()
      .query(SCHEMA)
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null; // retry on the next call instead of caching the failure
        throw error;
      });
  }
  return schemaReady;
}

async function pgRead<T>(key: ReviewKey): Promise<T | undefined> {
  await ensureSchema();
  const { rows } = await pool().query<{ value: T }>("SELECT value FROM review_doc WHERE key = $1", [key]);
  return rows[0]?.value;
}

async function pgWrite(key: ReviewKey, value: unknown): Promise<void> {
  await ensureSchema();
  await pool().query(
    `INSERT INTO review_doc (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/* ── the store ─────────────────────────────────────────────────────────── */

export async function readReview<T = unknown>(key: ReviewKey): Promise<T> {
  if (STANDALONE) {
    // Mutable documents come from Postgres; a DB row also beats the bundle
    // for samples so the agent can still reshape the queue remotely.
    if (WRITABLE_KEYS.has(key)) {
      const fromDb = await pgRead<T>(key);
      if (fromDb !== undefined) return fromDb;
    }
    if (BUNDLED_KEYS.has(key)) {
      return readJsonFile(path.join(bundledDir(), `${key}.json`), EMPTY[key] as T);
    }
    return EMPTY[key] as T;
  }
  const local = path.join(dataDir(), `${key}.json`);
  if (existsSync(local)) return readJsonFile(local, EMPTY[key] as T);
  // Local checkout without prepare.py output (or a non-Postgres host that
  // only has the bundle): fall back to the bundled copies before giving up.
  if (BUNDLED_KEYS.has(key)) return readJsonFile(path.join(bundledDir(), `${key}.json`), EMPTY[key] as T);
  return EMPTY[key] as T;
}

export async function writeReview(key: ReviewKey, value: unknown): Promise<void> {
  if (!WRITABLE_KEYS.has(key)) throw new Error(`${key} is not writable`);
  if (STANDALONE) {
    await pgWrite(key, value);
    return;
  }
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${key}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}
