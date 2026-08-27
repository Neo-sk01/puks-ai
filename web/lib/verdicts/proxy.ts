import "server-only";
import { FASTAPI_URL } from "../server";
import { extractDetail } from "../errors";
import type { MyVerdict, Summary } from "../acceptance";
import { HttpError, type RemoveResult, type UpsertResult, type VerdictsStore } from "./types";

/**
 * The pre-Postgres behaviour: every call is a fetch to the Python service,
 * exactly what web/lib/proxy.ts's proxyJson has always done for these
 * routes (same URL, same error extraction, same 502-on-unreachable
 * message). It's reshaped here to return parsed data or throw HttpError
 * instead of building a Response, because this module has to satisfy the
 * same VerdictsStore interface postgres.ts does — the request and response
 * bytes actually exchanged with FastAPI are unchanged.
 */
async function callFastAPI<T>(path: string, init?: RequestInit): Promise<T> {
  let upstream: Response;
  try {
    upstream = await fetch(`${FASTAPI_URL}${path}`, { cache: "no-store", ...init });
  } catch (error) {
    throw new HttpError(502, `Cannot reach the API at ${FASTAPI_URL}: ${(error as Error).message}`);
  }
  const raw = await upstream.text();
  if (!upstream.ok) {
    throw new HttpError(upstream.status, extractDetail(raw, upstream.statusText));
  }
  return raw ? (JSON.parse(raw) as T) : (undefined as T);
}

export const proxyStore: VerdictsStore = {
  async forTester(tester) {
    const data = await callFastAPI<{ verdicts: Record<string, MyVerdict> }>(
      `/api/acceptance/verdicts?tester=${encodeURIComponent(tester)}`,
    );
    return data.verdicts;
  },

  async upsert(questionId, testerName, verdict, note): Promise<UpsertResult> {
    return callFastAPI<UpsertResult>(`/api/acceptance/verdicts/${encodeURIComponent(questionId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tester_name: testerName, verdict, note }),
    });
  },

  async remove(questionId, testerName): Promise<RemoveResult> {
    // FastAPI's delete path (verdict: null) never reads `note` — see
    // api/acceptance.py's put_verdict, which validates it but never passes
    // it to store.delete — so the empty string here is inert. The response
    // it returns is exactly { question_id, tester, verdict: null } with
    // `tester` computed by Python's own normalise_tester, so there's no
    // need to recompute it on this side.
    return callFastAPI<RemoveResult>(`/api/acceptance/verdicts/${encodeURIComponent(questionId)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tester_name: testerName, verdict: null, note: "" }),
    });
  },

  async summary(): Promise<Summary> {
    // FastAPI computes its own question-id list from docs/acceptance-questions.json;
    // the questionIds argument only matters for postgres.ts's local aggregation.
    return callFastAPI<Summary>("/api/acceptance/summary");
  },
};
