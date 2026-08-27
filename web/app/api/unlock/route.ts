import { cookies } from "next/headers";
import { constantTimeEqual, deriveCookieValue } from "@/lib/access-code";
import { noStore } from "@/lib/no-store";

/** Node runtime: constantTimeEqual needs node:crypto's timingSafeEqual. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "puks_access";
const MAX_AGE = 60 * 60 * 24 * 180; // ~6 months — a shared code for a QA tool, not a per-user session

/**
 * The one way the puks_access cookie web/proxy.ts checks for gets set.
 * Deliberately outside that gate's matcher (see web/proxy.ts) — otherwise
 * no one could ever unlock.
 *
 * ACCEPTANCE_CODE is compared with a timing-safe comparison (see
 * lib/access-code.ts) and never logged, including on failure. The cookie
 * itself stores deriveCookieValue(code), not the code — see that
 * function's docstring for why.
 */
export async function POST(request: Request) {
  const code = process.env.ACCEPTANCE_CODE;
  if (!code) {
    return noStore(Response.json({ detail: "access code is not configured" }, { status: 404 }));
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return noStore(Response.json({ detail: "request body must be JSON" }, { status: 400 }));
  }

  const attempt = typeof body.code === "string" ? body.code : "";
  if (!attempt || !constantTimeEqual(attempt, code)) {
    return noStore(Response.json({ detail: "incorrect access code" }, { status: 401 }));
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE, deriveCookieValue(code), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return noStore(Response.json({ ok: true }));
}
