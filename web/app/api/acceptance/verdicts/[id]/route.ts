import { VERDICTS, type Verdict } from "@/lib/acceptance";
import { bundledQuestionIds } from "@/lib/acceptance-bundled";
import { STANDALONE } from "@/lib/deployment";
import { getVerdictsStore, HttpError } from "@/lib/verdicts";

export const dynamic = "force-dynamic";

const NAME_MAX = 60;
const NOTE_MAX = 500;

/** Mirrors api/acceptance.py's put_verdict, check for check and in the same
 *  order: unknown question id -> 404, bad tester_name -> 400, note too long
 *  -> 400, bad verdict -> 400, else upsert or (verdict: null) delete.
 *
 *  The question-id check only has bundled data to consult in standalone
 *  mode (see lib/deployment.ts) — in proxy mode there is no local copy of
 *  the question set, so that one check is left to FastAPI, which enforces
 *  it itself and returns 404 the same way it always has; the three pure
 *  checks below it don't depend on where the data lives, so they run
 *  identically either way, one hop earlier than they used to in proxy mode. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: { tester_name?: unknown; verdict?: unknown; note?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ detail: "request body must be JSON" }, { status: 400 });
  }

  if (STANDALONE && !bundledQuestionIds().has(id)) {
    return Response.json({ detail: `unknown question ${id}` }, { status: 404 });
  }

  const name = typeof body.tester_name === "string" ? body.tester_name.trim() : "";
  if (!name || name.length > NAME_MAX) {
    return Response.json({ detail: `tester_name must be 1-${NAME_MAX} characters` }, { status: 400 });
  }

  const note = typeof body.note === "string" ? body.note : "";
  if (note.length > NOTE_MAX) {
    return Response.json({ detail: `note must be at most ${NOTE_MAX} characters` }, { status: 400 });
  }

  const rawVerdict = body.verdict;
  if (rawVerdict !== null && (typeof rawVerdict !== "string" || !VERDICTS.includes(rawVerdict as Verdict))) {
    return Response.json({ detail: `verdict must be one of ['pass', 'partial', 'fail'] or null` }, { status: 400 });
  }
  const verdict = rawVerdict as Verdict | null;

  try {
    const store = await getVerdictsStore();
    const result = verdict === null ? await store.remove(id, name) : await store.upsert(id, name, verdict, note);
    return Response.json(result);
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ detail: error.detail }, { status: error.status });
    return Response.json({ detail: (error as Error).message }, { status: 502 });
  }
}
