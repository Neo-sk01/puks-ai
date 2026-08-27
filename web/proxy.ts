import { NextResponse, type NextRequest } from "next/server";

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
 */
const COOKIE = "puks_access";

export function proxy(request: NextRequest) {
  const code = process.env.ACCEPTANCE_CODE;
  if (!code) return NextResponse.next();

  if (request.cookies.get(COOKIE)?.value === code) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/acceptance")) {
    return NextResponse.json({ detail: "access code required" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/unlock";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/acceptance/:path*", "/api/acceptance/:path*"],
};
