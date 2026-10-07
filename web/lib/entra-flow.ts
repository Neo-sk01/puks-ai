import { SignJWT, jwtVerify } from "jose";

/**
 * Two short-lived signed tokens that carry the Entra sign-in flow across
 * its two legs (GET /api/auth/entra/signin → Microsoft → GET
 * /api/auth/entra/callback) and then into next-auth's own session.
 *
 * No `secret` default and no `server-only` import here on purpose: this
 * file is pure (secret passed in, no env/cookie/request access), which is
 * what lets entra-flow.test.ts exercise it directly. The only callers are
 * the two route handlers under app/api/auth/entra/, which are server-only
 * by construction — same shape as lib/callback-url.ts elsewhere in this repo.
 */

function key(secret: string) {
  return new TextEncoder().encode(secret);
}

/** state: CSRF protection on the redirect back from Microsoft.
 *  nonce: passed through to MSAL's acquireTokenByCode so it can reject an
 *    ID token that doesn't carry the nonce we generated (opt-in check —
 *    see lib/msal.ts's doc comment on why that matters).
 *  codeVerifier: the PKCE secret half; codeChallenge (derived from it) is
 *    what actually goes to Microsoft.
 *  callbackUrl: where to send the browser after sign-in completes —
 *    sanitized by lib/callback-url.ts before it ever reaches here. */
export interface FlowState {
  state: string;
  nonce: string;
  codeVerifier: string;
  callbackUrl: string;
}

/** Name of the signed cookie that carries FlowState across the two legs.
 *  Lives here rather than in either route file — a route.ts file may only
 *  export HTTP method handlers and a small fixed set of special names
 *  (config, generateStaticParams, ...); Next's typed-routes checking
 *  rejects any other named export, which an app/api/.../signin/route.ts
 *  export of this constant used to trip under `next build --webpack`. */
export const FLOW_COOKIE = "puks-entra-flow";

const FLOW_COOKIE_TTL = "10m";

export async function signFlowState(secret: string, data: FlowState): Promise<string> {
  return new SignJWT({ ...data })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(FLOW_COOKIE_TTL)
    .sign(key(secret));
}

/** Null on anything wrong — expired, tampered, or malformed. Callers treat
 *  that as "the flow cookie is gone", the same as if it had never been set. */
export async function verifyFlowState(secret: string, token: string): Promise<FlowState | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret));
    const { state, nonce, codeVerifier, callbackUrl } = payload;
    if (
      typeof state !== "string" ||
      typeof nonce !== "string" ||
      typeof codeVerifier !== "string" ||
      typeof callbackUrl !== "string"
    ) {
      return null;
    }
    return { state, nonce, codeVerifier, callbackUrl };
  } catch {
    return null;
  }
}

/**
 * The handoff ticket from app/api/auth/entra/callback/route.ts (after MSAL
 * has verified the code exchange and the certificate assertion) to
 * auth.ts's Credentials provider.
 *
 * This exists because /api/auth/callback/entra-bridge — next-auth's own
 * route for that provider — is reachable directly over HTTP like any
 * Credentials callback; `authorize()` there has no way to tell "this came
 * from our own verified MSAL flow" from "someone POSTed made-up claims"
 * except by checking a signature it can verify itself. A 60-second expiry
 * and a fixed issuer keep a captured ticket from being replayed later or
 * reused anywhere else that trusts the same AUTH_SECRET.
 */
export interface EntraTicketClaims {
  oid: string;
  tid: string;
  name?: string;
  email?: string;
}

const TICKET_ISSUER = "puks-ai:entra-bridge";
const TICKET_TTL = "60s";

export async function signEntraTicket(secret: string, claims: EntraTicketClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(TICKET_ISSUER)
    .setIssuedAt()
    .setExpirationTime(TICKET_TTL)
    .sign(key(secret));
}

/** `expectedTenantId` is checked again here — belt-and-braces alongside the
 *  check callback/route.ts already does against the live MSAL result — so
 *  that even a bug upstream can't mint a ticket for the wrong tenant and
 *  have this layer wave it through. */
export async function verifyEntraTicket(
  secret: string,
  token: string,
  expectedTenantId: string,
): Promise<EntraTicketClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { issuer: TICKET_ISSUER });
    const { oid, tid, name, email } = payload;
    if (typeof oid !== "string" || typeof tid !== "string") return null;
    if (tid !== expectedTenantId) return null;
    return {
      oid,
      tid,
      name: typeof name === "string" ? name : undefined,
      email: typeof email === "string" ? email : undefined,
    };
  } catch {
    return null;
  }
}
