import "server-only";
import type { AppConfig, Health } from "./types";
import type { QuestionGroup, RecordedResult, RunMeta } from "./acceptance";
import { STANDALONE } from "./deployment";
import { bundledQuestionGroups, bundledResults } from "./acceptance-bundled";

/** Server-only. Never imported from a client component — the URL, and any
 *  credential added to it later, must not reach the browser. The Health type
 *  itself lives in ./types so client components can name it. */
export const FASTAPI_URL = process.env.FASTAPI_URL ?? "http://127.0.0.1:8001";

export type { Health };

export async function getHealth(): Promise<Health> {
  try {
    const response = await fetch(`${FASTAPI_URL}/health`, { cache: "no-store" });
    if (!response.ok) throw new Error(`health returned ${response.status}`);
    return await response.json();
  } catch (error) {
    return {
      ready: false,
      mock: false,
      error: `Cannot reach the API at ${FASTAPI_URL}: ${(error as Error).message}`,
      index: { dimension: null, ntotal: null, model: null },
      rerank_configured: false,
    };
  }
}

export async function getConfig(): Promise<AppConfig | null> {
  try {
    const response = await fetch(`${FASTAPI_URL}/api/config`, { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function getAcceptanceQuestions(): Promise<QuestionGroup[]> {
  // Standalone deploys (Vercel, no Python service) have no FASTAPI_URL to
  // ask — serve the set bundled at build time instead. See lib/deployment.ts.
  if (STANDALONE) return bundledQuestionGroups();
  try {
    const response = await fetch(`${FASTAPI_URL}/api/acceptance/questions`, { cache: "no-store" });
    return response.ok ? (await response.json()).groups : [];
  } catch {
    return [];
  }
}

export async function getAcceptanceResults(): Promise<{ run: RunMeta | null; results: Record<string, RecordedResult> }> {
  if (STANDALONE) return bundledResults();
  try {
    const response = await fetch(`${FASTAPI_URL}/api/acceptance/results`, { cache: "no-store" });
    return response.ok ? await response.json() : { run: null, results: {} };
  } catch {
    return { run: null, results: {} };
  }
}
