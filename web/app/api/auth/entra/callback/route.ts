import { cookies } from "next/headers";
import { auth, signIn } from "@/auth";
import { FLOW_COOKIE, signEntraTicket, verifyFlowState } from "@/lib/entra-flow";
import { AUTH_CONFIGURED, ENTRA_CLIENT_ID, ENTRA_SCOPES, ENTRA_TENANT_ID, msalApp } from "@/lib/msal";
import { publicOrigin } from "@/lib/request-origin";

export const dynamic = "force-dynamic";

function errorRedirect(request: Request, code: string): Response {
  const url = new URL("/sign-in", publicOrigin(request));
  url.searchParams.set("error", code);
  return Response.redirect(url, 302);
}

function redirectUri(request: Request): string {
  return new URL("/api/auth/entra/callback", publicOrigin(request)).toString();
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

  // Guards against a duplicate/replayed callback request — observed in
  // practice, the browser firing the exact same callback URL (same code,
  // same state) twice in a row. Entra authorization codes are single-use:
  // a second request with the same code always fails with AADSTS54005
  // ("already redeemed"), even when the first request already succeeded
  // and signed the visitor in. Checking for an existing session first
  // means that case redirects straight through instead of showing a
  // confusing error for a sign-in that actually worked.
  const already = await auth();
  if (already?.user) {
    const existingFlowCookie = (await cookies()).get(FLOW_COOKIE)?.value;
    const existingFlow = existingFlowCookie
      ? await verifyFlowState(process.env.AUTH_SECRET!, existingFlowCookie)
      : null;
    return Response.redirect(new URL(existingFlow?.callbackUrl ?? "/", publicOrigin(request)), 302);
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
      //
      // Deliberately no `state` here, even though the type allows it:
      // when present, ResponseHandler.ts feeds it through
      // ProtocolUtils.parseRequestState(), which expects MSAL's own
      // library-state encoding (a base64-JSON prefix this app never
      // produces, since `state` here is a plain value we generate and
      // verify ourselves below) — always throwing `invalid_state`
      // otherwise. Our own `flow.state !== returnedState` check above
      // already *is* the CSRF protection `state` exists for; MSAL's
      // parsed version would be redundant even if it were wired up.
      { code, nonce: flow.nonce },
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
  } catch (error) {
    // Covers every MSAL failure mode here: a rejected certificate
    // assertion, an expired/replayed code, a nonce mismatch, a network
    // error reaching Entra. None of them are actionable by the visitor
    // beyond "try signing in again", but worth a server-side trace for
    // whoever's operating this — a silent catch here is exactly what made
    // an earlier, unrelated bug (a malformed private key) hard to find.
    console.error("[entra/callback] acquireTokenByCode failed:", error);
    return errorRedirect(request, "OAuthCallback");
  }

  const ticket = await signEntraTicket(process.env.AUTH_SECRET!, { oid, tid, name, email });

  try {
    await signIn("entra-bridge", { ticket, redirect: false });
  } catch (error) {
    console.error("[entra/callback] signIn(entra-bridge) failed:", error);
    return errorRedirect(request, "AccessDenied");
  }

  // signIn() above doesn't throw when the Credentials provider's
  // authorize() quietly declines (as opposed to erroring) — confirm a
  // session actually landed in the cookie jar before treating this as
  // success, rather than redirecting someone to callbackUrl "signed in"
  // when they aren't. (requireSession()/proxy.ts would catch this either
  // way — see lib/auth-guard.ts — this just avoids the confusing round
  // trip of landing on the target page and being bounced straight back.)
  if (!(await auth())?.user) {
    console.error("[entra/callback] signIn succeeded but no session followed; ticket for oid:", oid);
    return errorRedirect(request, "AccessDenied");
  }

  return Response.redirect(new URL(flow.callbackUrl, publicOrigin(request)), 302);
}
