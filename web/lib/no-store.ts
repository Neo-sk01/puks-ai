import "server-only";

/**
 * Marks a response as uncacheable by any shared or private cache, and adds
 * it in place — mutating and returning the same Response (or NextResponse,
 * which extends it) so callers can wrap a return value inline.
 *
 * Why this exists: every /api/acceptance/* route already sets
 * `export const dynamic = "force-dynamic"`, but that only tells Next not
 * to prerender the route — it says nothing to Vercel's CDN about whether
 * the *response* it hands back may be cached. Left alone, the response
 * carries the framework default `Cache-Control: public, max-age=0,
 * must-revalidate`, which still lets a shared cache store a 200 (that's
 * how a deleted verdict kept reappearing in GET /api/acceptance/summary —
 * a cache-busting query string was the only thing that showed the true
 * state). Worse, these routes sit behind the puks_access cookie gate in
 * proxy.ts: `public` with no `Vary: Cookie` means a cached response could
 * in principle be served to a requester who never presented the access
 * code, bypassing the gate entirely. The data behind it is AGL's internal
 * acceptance questions and recorded answers.
 *
 * `private, no-store` tells every cache — CDN and browser alike — not to
 * store the response at all; `Vary: Cookie` is belt-and-braces in case
 * some intermediary still consults Vary before honouring Cache-Control.
 *
 * Applied uniformly to success AND error responses: a cached 401 or 404
 * is its own bug, not just a cached 200.
 */
export function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}
