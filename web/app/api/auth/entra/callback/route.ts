import { cookies } from "next/headers";
import { auth, signIn } from "@/auth";
import { signEntraTicket, verifyFlowState } from "@/lib/entra-flow";
import { AUTH_CONFIGURED, ENTRA_CLIENT_ID, ENTRA_SCOPES, ENTRA_TENANT_ID, msalApp } from "@/lib/msal";
import { FLOW_COOKIE } from "../signin/route";

export const dynamic = "force-dynamic";

function errorRedirect(request: Request, code: string): Response {
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("error", code);
  return Response.redirect(url, 302);
}

function redirectUri(request: Request): string {
  return new URL("/api/auth/entra/callback", request.url).toString();
}

/** Leg 2: Microsoft redirects here with `code` + `state`. This is the one
 *  place the certificate assertion actually gets used — acquireTokenByCode
 *  exchanges `code` for tokens, authenticating itself to Entra's token
 *  endpoint with the PS256/x5t#S256 assertion MSAL builds from
 *  AUTH_MICROSOFT_ENTRA_ID_CERT_*. See lib/msal.ts for why that can't go
 *  through next-auth's own provider.
 *
 *  Nothing from Microsoft is trusted onto the session as-is: the tenant
 *  and audience are re-checked here even though the authority URL and
 *  client id already constrain them, and the result is handed to
 *  next-auth only as a short-lived *signed ticket*
 *  (lib/entra-flow.ts's signEntraTicket) — never as raw claims — because
 *  the Credentials provider's authorize() in auth.ts has no other way to
 *  tell "this came from here" from "someone POSTed made-up data". */
export async function GET(request: Request) {
  if (!AUTH_CONFIGURED || !msalApp || !ENTRA_TENANT_ID || !ENTRA_CLIENT_ID) {
    return errorRedirect(request, "Configuration");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  const jar = await cookies();
  const flowCookie = jar.get(FLOW_COOKIE)?.value;
  // One-shot: whether this succeeds or fails, the flow cookie has done its
  // job and a retry needs a fresh state/nonce/verifier from leg 1 anyway.
  jar.delete(FLOW_COOKIE);

  if (providerError) return errorRedirect(request, "AccessDenied");
  if (!code || !returnedState || !flowCookie) return errorRedirect(request, "OAuthCallback");

  const flow = await verifyFlowState(process.env.AUTH_SECRET!, flowCookie);
  if (!flow || flow.state !== returnedState) return errorRedirect(request, "OAuthCallback");

  let oid: string | undefined;
  let tid: string | undefined;
  let name: string | undefined;
  let email: string | undefined;

  try {
    const result = await msalApp.acquireTokenByCode(
      {
        code,
        scopes: ENTRA_SCOPES,
        redirectUri: redirectUri(request),
        codeVerifier: flow.codeVerifier,
      },
      // Second argument, not request options: this is what makes
      // acquireTokenByCode check the ID token's nonce against ours and
      // throw nonceMismatch otherwise — see node_modules/.../@azure/
      // msal-common/src/response/ResponseHandler.ts. Omitting this
      // argument silently skips that check rather than failing safe.
      { code, state: returnedState, nonce: flow.nonce },
    );

    const claims = result.idTokenClaims as
      | { oid?: string; tid?: string; aud?: string; name?: string; email?: string; preferred_username?: string }
      | undefined;

    // Belt-and-braces: the authority URL (tenant-scoped) and our client id
    // already constrain these at the protocol level, but check them again
    // rather than trust that implicitly — same posture as proxy.ts +
    // lib/auth-guard.ts elsewhere in this app.
    if (!claims?.oid || claims.tid !== ENTRA_TENANT_ID || claims.aud !== ENTRA_CLIENT_ID) {
      return errorRedirect(request, "AccessDenied");
    }

    oid = claims.oid;
    tid = claims.tid;
    name = claims.name;
    email = claims.email ?? claims.preferred_username;
  } catch {
    // Covers every MSAL failure mode here: a rejected certificate
    // assertion, an expired/replayed code, a nonce mismatch, a network
    // error reaching Entra. None of them are actionable by the visitor
    // beyond "try signing in again".
    return errorRedirect(request, "OAuthCallback");
  }

  const ticket = await signEntraTicket(process.env.AUTH_SECRET!, { oid, tid, name, email });

  try {
    await signIn("entra-bridge", { ticket, redirect: false });
  } catch {
    return errorRedirect(request, "AccessDenied");
  }

  // signIn() above doesn't throw when the Credentials provider's
  // authorize() quietly declines (as opposed to erroring) — confirm a
  // session actually landed in the cookie jar before treating this as
  // success, rather than redirecting someone to callbackUrl "signed in"
  // when they aren't. (requireSession()/proxy.ts would catch this either
  // way — see lib/auth-guard.ts — this just avoids the confusing round
  // trip of landing on the target page and being bounced straight back.)
  if (!(await auth())?.user) return errorRedirect(request, "AccessDenied");

  return Response.redirect(new URL(flow.callbackUrl, request.url), 302);
}
