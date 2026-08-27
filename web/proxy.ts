import { NextResponse, type NextRequest } from "next/server";
import { constantTimeEqual, deriveCookieValue } from "@/lib/access-code";
import { noStore } from "@/lib/no-store";
import { safeNextPath } from "@/lib/safe-redirect";

/**
 * Next.js's file-convention name for what used to be middleware.ts —
 * renamed in Next 16 (see node_modules/next/dist/docs/01-app/03-api-
 * reference/03-file-conventions/proxy.md; middleware.ts still resolves but
 * is deprecated). Unrelated to this app's other "proxy" naming
 * (lib/proxy.ts, lib/verdicts/proxy.ts), which forwards requests to
 * FastAPI — this one gates access to the acceptance surface.
 *
 * Guards /acceptance and /api/acceptance/* behind a single shared code, for
 * the Vercel deploy where anyone with the URL could otherwise reach them:
 * no valid puks_access cookie means a redirect to /unlock for page
 * requests, or a 401 { detail } for API requests.
 *
 * Inert when ACCEPTANCE_CODE isn't set — local development, and any
 * deployment that hasn't opted in — so the existing no-login workflow is
 * completely untouched there.
 *
 * /unlock (the page) and /api/unlock (the route that sets the cookie) are
 * deliberately outside the matcher below: gating them would make it
 * impossible to ever unlock.
 *
 * The cookie is checked with constantTimeEqual, not `===`: this runs on
 * every request to a guarded path, making it the single most-hit
 * comparison against the shared secret in the app, so it gets the same
 * timing-safe treatment as /api/unlock. It's compared against
 * deriveCookieValue(code) rather than the raw code, matching what
 * app/api/unlock/route.ts actually stores in the cookie (see
 * lib/access-code.ts's deriveCookieValue docstring for why the cookie
 * holds a derived value instead of the code itself).
 *
 * Per node_modules/next/dist/docs/.../proxy.md ("## Runtime"), Proxy
 * defaults to the Node.js runtime and does NOT support a `runtime` config
 * export (setting one throws) — so node:crypto is available here with no
 * extra opt-in.
 */
const COOKIE = "puks_access";

export function proxy(request: NextRequest) {
  const code = process.env.ACCEPTANCE_CODE;
  if (!code) return NextResponse.next();

  const presented = request.cookies.get(COOKIE)?.value;
  if (presented !== undefined && constantTimeEqual(presented, deriveCookieValue(code))) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/acceptance")) {
    // Same no-store policy as the routes themselves (see lib/no-store.ts):
    // this 401 is the gate's own denial, and a cached one is exactly the
    // bypass the gate exists to prevent.
    return noStore(NextResponse.json({ detail: "access code required" }, { status: 401 }));
  }

  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  // pathname always starts with "/" (it's request.nextUrl.pathname, not
  // attacker input) so this is already a safe relative path, but it's run
  // through the same validator that consumes it — see lib/safe-redirect.ts
  // — so the producing and consuming ends can never drift apart.
  url.searchParams.set("next", safeNextPath(pathname));
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/acceptance/:path*", "/api/acceptance/:path*"],
};
