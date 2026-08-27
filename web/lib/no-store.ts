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
 * state).
 *
 * `private, no-store` tells every cache — CDN and browser alike — not to
 * store the response at all. No `Vary` header is set: these routes are no
 * longer behind any auth cookie, so there's nothing for a cache to vary on
 * — `no-store` alone already forbids storing the response in the first
 * place.
 *
 * Applied uniformly to success AND error responses: a cached 400 or 404
 * is its own bug, not just a cached 200.
 */
export function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
