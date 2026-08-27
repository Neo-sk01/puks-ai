import { bundledQuestionIds } from "@/lib/acceptance-bundled";
import { STANDALONE } from "@/lib/deployment";
import { getVerdictsStore, HttpError } from "@/lib/verdicts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = await getVerdictsStore();
    // postgresStore needs the full question-id list to build zero-counts
    // for unscored questions (mirrors api/acceptance.py passing
    // [q["id"] for q in _questions()]); proxyStore ignores it — FastAPI
    // computes its own from the same docs/acceptance-questions.json.
    const ids = STANDALONE ? [...bundledQuestionIds()] : [];
    const summary = await store.summary(ids);
    return Response.json(summary);
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ detail: error.detail }, { status: error.status });
    return Response.json({ detail: (error as Error).message }, { status: 502 });
  }
}
