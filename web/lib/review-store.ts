import "server-only";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * File-backed store for the review tool. Six JSON documents under
 * evals/error-discovery/data (one directory up from web/), the same files
 * prepare.py writes and the agent reads — so a reviewer's notes are plain
 * files in the repo, not rows in a service.
 *
 * Writes are whole-document replaces through a temp file + rename, which is
 * atomic on POSIX and what keeps an agent-side reader from ever seeing a
 * half-written annotations.json. PUKS_REVIEW_DATA overrides the directory
 * (tests point it at a temp dir).
 */

export const REVIEW_KEYS = ["records", "samples", "annotations", "graph", "patterns", "suggestions"] as const;
export type ReviewKey = (typeof REVIEW_KEYS)[number];
export const WRITABLE_KEYS: ReadonlySet<ReviewKey> = new Set<ReviewKey>(["samples", "annotations", "patterns", "suggestions"]);

const EMPTY: Record<ReviewKey, unknown> = {
  records: [], samples: { ids: [] }, annotations: [], graph: [], patterns: {}, suggestions: [],
};

export function isReviewKey(key: string): key is ReviewKey {
  return (REVIEW_KEYS as readonly string[]).includes(key);
}

export function dataDir(): string {
  return process.env.PUKS_REVIEW_DATA ?? path.resolve(process.cwd(), "..", "evals", "error-discovery", "data");
}

export function readReview<T = unknown>(key: ReviewKey): T {
  const file = path.join(dataDir(), `${key}.json`);
  if (!existsSync(file)) return EMPTY[key] as T;
  try {
    return JSON.parse(readFileSync(file, "utf-8")) as T;
  } catch {
    return EMPTY[key] as T;
  }
}

export function writeReview(key: ReviewKey, value: unknown): void {
  if (!WRITABLE_KEYS.has(key)) throw new Error(`${key} is not writable`);
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${key}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}
