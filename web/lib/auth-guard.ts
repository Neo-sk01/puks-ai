import "server-only";
import { redirect } from "next/navigation";
import { auth, AUTH_CONFIGURED } from "@/auth";
import type { Session } from "next-auth";

/**
 * The Data Access Layer check Next's own auth guide asks every page to make
 * (node_modules/next/dist/docs/01-app/02-guides/authentication.md,
 * "Creating a Data Access Layer"), rather than trusting proxy.ts alone —
 * that guide is explicit that Proxy is an optimistic pre-filter, not "your
 * only line of defense."
 *
 * In the normal path proxy.ts has already redirected an unauthenticated
 * visitor before this ever runs; this exists for the cases proxy's own
 * docs call out as its blind spots (a matcher edit that stops covering a
 * route, a static/ISR page cached before this feature existed) and because
 * duplicating the check here costs one cheap cookie-decode, not a
 * database round trip (JWT session strategy).
 */
export async function requireSession(callbackPath: string): Promise<Session> {
  const session = await auth();
  if (!session?.user) {
    const qs = AUTH_CONFIGURED ? `?callbackUrl=${encodeURIComponent(callbackPath)}` : "";
    redirect(`/sign-in${qs}`);
  }
  return session;
}

/**
 * Same idea for Route Handlers (node_modules/next/dist/docs/.../
 * authentication.md, "Route Handlers"). Returns a 401 JSON Response to
 * return early with, or null when the caller may proceed — a Route Handler
 * must not redirect a `fetch()` caller, which would otherwise be handed an
 * HTML sign-in page where it expects JSON.
 */
export async function requireApiSession(): Promise<Response | null> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ detail: "Sign-in required" }, { status: 401 });
  }
  return null;
}
