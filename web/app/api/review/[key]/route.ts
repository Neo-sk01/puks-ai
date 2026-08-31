import { noStore } from "@/lib/no-store";
import { isReviewKey, readReview, WRITABLE_KEYS, writeReview } from "@/lib/review-store";

export const dynamic = "force-dynamic";

/** GET /api/review/{records|samples|annotations|graph|patterns|suggestions}
 *  POST replaces the whole document for the four reviewer/agent-owned keys.
 *  The app POSTs annotations on every change and polls samples, suggestions
 *  and patterns; the agent POSTs the other three from outside the app.
 *  Storage (repo files locally, Postgres on standalone deploys) is
 *  lib/review-store.ts's concern. */
export async function GET(_request: Request, ctx: RouteContext<"/api/review/[key]">) {
  const { key } = await ctx.params;
  if (!isReviewKey(key)) return noStore(Response.json({ detail: "unknown key" }, { status: 404 }));
  try {
    return noStore(Response.json(await readReview(key)));
  } catch (error) {
    return noStore(Response.json({ detail: (error as Error).message }, { status: 502 }));
  }
}

export async function POST(request: Request, ctx: RouteContext<"/api/review/[key]">) {
  const { key } = await ctx.params;
  if (!isReviewKey(key)) return noStore(Response.json({ detail: "unknown key" }, { status: 404 }));
  if (!WRITABLE_KEYS.has(key)) return noStore(Response.json({ detail: `${key} is read-only` }, { status: 405 }));
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return noStore(Response.json({ detail: "body must be JSON" }, { status: 400 }));
  }
  try {
    await writeReview(key, body);
    return noStore(Response.json({ ok: true }));
  } catch (error) {
    return noStore(Response.json({ detail: (error as Error).message }, { status: 502 }));
  }
}
