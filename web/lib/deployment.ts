import "server-only";

/**
 * True when this deployment has no FastAPI service behind it — the Vercel
 * deploy, where acceptance verdicts live in a provisioned Postgres database
 * instead of proxying to Python. Detected by the presence of POSTGRES_URL
 * (Vercel Postgres / Neon's default var name) or DATABASE_URL (the generic
 * name most other Postgres add-ons use) — whichever is set is also what
 * lib/verdicts/postgres.ts connects with.
 *
 * False everywhere else, including local development against uvicorn on
 * :8001: every acceptance route then behaves exactly as it did before this
 * file existed, proxying to FASTAPI_URL.
 *
 * This is the single source of truth for the flag. lib/verdicts/index.ts
 * (which store backs verdicts) and lib/acceptance-bundled.ts's callers
 * (which serve questions/results) both import it, so the two concerns can
 * never disagree about which mode a given deploy is running in.
 */
export const STANDALONE = Boolean(process.env.POSTGRES_URL || process.env.DATABASE_URL);
