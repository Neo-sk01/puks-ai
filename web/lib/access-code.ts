import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison, so a wrong guess at /api/unlock can't be
 * narrowed down character-by-character via response-time measurement — the
 * classic timing side-channel a naive `a === b` is open to. Node's crypto
 * module has this built in (timingSafeEqual), but it throws on unequal
 * buffer lengths, so unequal lengths are rejected up front instead — that
 * branch is length-dependent in timing, but a length mismatch is already a
 * guaranteed miss, so it leaks nothing about the code's actual content.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Fixed application-level label, HMAC'd with ACCEPTANCE_CODE as the key —
 * deliberately NOT a secret itself, just a domain separator so this
 * derivation can't be confused with any other HMAC that might someday key
 * off the same code.
 */
const COOKIE_DERIVATION_LABEL = "puks-ai:acceptance-cookie:v1";

/**
 * Derives the opaque value stored in the puks_access cookie from the real
 * ACCEPTANCE_CODE, rather than putting the code in the cookie verbatim.
 *
 * DO NOT "simplify" this back to storing the raw code:
 *  - web/proxy.ts compares this value on every single request to
 *    /acceptance/* and /api/acceptance/* — it is by far the most exposed
 *    comparison against the shared secret in this app. If the cookie held
 *    the raw code, a leaked cookie (XSS, a logged request, a shared
 *    laptop's browser storage) directly hands over the real credential.
 *  - HMAC-SHA256 with the code as the *key* is one-way: recovering the
 *    code from this output is infeasible, so a leaked cookie only grants
 *    the session it was already good for, not the code itself.
 *  - Keying by the code (rather than, say, hashing a session id issued at
 *    unlock time) also means rotating ACCEPTANCE_CODE instantly
 *    invalidates every previously-issued cookie with zero extra
 *    bookkeeping — there is no session store to also clear.
 *
 * Computed identically in app/api/unlock/route.ts (when setting the
 * cookie) and web/proxy.ts (when checking it); compare the results with
 * constantTimeEqual, never `===`.
 */
export function deriveCookieValue(code: string): string {
  return createHmac("sha256", code).update(COOKIE_DERIVATION_LABEL).digest("hex");
}
