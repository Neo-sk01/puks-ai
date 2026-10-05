/**
 * SSO gate — Next.js 16's Proxy (the renamed Middleware; see
 * node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
 * Runs on the Node.js runtime by default in 16, so next-auth's JWT
 * decoding needs no Edge-specific shims.
 *
 * `auth` re-exported directly as `proxy` is next-auth's own documented
 * pattern (previously `export { auth as middleware }`); the decision of
 * who gets through is entirely in auth.ts's `callbacks.authorized`.
 *
 * This is an OPTIMISTIC check — it reads the session from a cookie, no
 * database round trip, which is exactly what Next's own auth guide asks
 * Proxy to stay limited to (node_modules/next/dist/docs/01-app/02-guides/
 * authentication.md, "Optimistic checks with Proxy"). Every page and every
 * API route handler re-checks the session itself (lib/auth-guard.ts) —
 * this is the fast pre-filter, not the only line of defense.
 */
export { auth as proxy } from "@/auth";

export const config = {
  matcher: [
    /*
     * Run on everything except:
     *  - /api/auth/*   next-auth's own routes — gating these makes signing
     *                  in impossible
     *  - /_next/*      framework internals and image optimization
     *  - well-known static files served from app/ or public/
     */
    "/((?!api/auth|_next/static|_next/image|favicon\\.ico|icon\\.png|apple-icon\\.png|agl-logo\\.png|.*\\.svg$).*)",
  ],
};
