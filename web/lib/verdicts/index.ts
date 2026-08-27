import "server-only";
import { STANDALONE } from "../deployment";
import type { VerdictsStore } from "./types";

export type { VerdictsStore } from "./types";
export { HttpError } from "./types";

/**
 * Which backend stores verdicts. Postgres when POSTGRES_URL or DATABASE_URL
 * is set — that's how lib/deployment.ts's STANDALONE detects "this is the
 * Vercel deploy, there's no FastAPI behind it" — and the existing FastAPI
 * proxy everywhere else, including local development against uvicorn on
 * :8001, so nothing changes there.
 *
 * Both branches are dynamic imports so postgres.ts (and its `pg`
 * dependency) is only ever loaded in a process that's actually going to use
 * it — local dev never pulls in `pg` at all.
 */
export async function getVerdictsStore(): Promise<VerdictsStore> {
  if (STANDALONE) {
    const { postgresStore } = await import("./postgres");
    return postgresStore;
  }
  const { proxyStore } = await import("./proxy");
  return proxyStore;
}
