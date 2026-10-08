import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { safeCallbackUrl } from "@/lib/callback-url";
import { FLOW_COOKIE, signFlowState } from "@/lib/entra-flow";
import { AUTH_CONFIGURED, ENTRA_SCOPES, cryptoProvider, msalApp } from "@/lib/msal";
import { publicOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

function redirectUri(request: Request): string {
  return new URL("/api/auth/entra/callback", publicOrigin(request)).toString();
}

/** Leg 1 of the certificate-based Entra sign-in (see lib/msal.ts for why
 *  this bypasses next-auth's own OAuth provider). Builds the authorize URL
 *  with a fresh state/nonce/PKCE pair, stores them in a short-lived signed
 *  cookie (lib/entra-flow.ts), and redirects to Microsoft.
 *
 *  app/sign-in/page.tsx links here as a plain GET — there's nothing to
 *  protect on this leg beyond what the state/nonce protect on the way
 *  back, so no form/CSRF token is needed just to start the flow. */
export async function GET(request: Request) {
  if (!AUTH_CONFIGURED || !msalApp) {
    return Response.json({ detail: "Sign-in is not configured" }, { status: 503 });
  }

  const url = new URL(request.url);
  const callbackUrl = safeCallbackUrl(url.searchParams.get("callbackUrl") ?? undefined);

  const state = randomBytes(16).toString("hex");
  const nonce = randomBytes(16).toString("hex");
  const { verifier, challenge } = await cryptoProvider.generatePkceCodes();

  const authCodeUrl = await msalApp.getAuthCodeUrl({
    scopes: ENTRA_SCOPES,
    redirectUri: redirectUri(request),
    state,
    nonce,
    codeChallenge: challenge,
    codeChallengeMethod: "S256",
  });

  const flowCookie = await signFlowState(process.env.AUTH_SECRET!, {
    state,
    nonce,
    codeVerifier: verifier,
    callbackUrl,
  });

  const jar = await cookies();
  jar.set(FLOW_COOKIE, flowCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/entra",
    maxAge: 10 * 60,
  });

  return Response.redirect(authCodeUrl, 302);
}
