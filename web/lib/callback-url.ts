/** Relative paths only. A crafted `?callbackUrl=` must not be able to land a
 *  just-signed-in visitor off this origin — `/(?!\/)` accepts "/acceptance"
 *  but rejects both an absolute URL ("https://evil.com") and a
 *  protocol-relative one ("//evil.com", which a bare `startsWith("/")`
 *  check would miss: browsers resolve a `//host/path` redirect target
 *  against the current protocol, landing on a different origin).
 *
 *  next-auth's own default `redirect` callback already closes this
 *  independently, by prefixing whatever it's given with `baseUrl` before
 *  returning it (node_modules/.../@auth/core/src/lib/init.ts) — this is a
 *  second, cheap check on top, in keeping with this repo having already
 *  had to close an open-redirect once (see git log for "open-redirect"). */
export function safeCallbackUrl(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && /^\/(?!\/)/.test(value) ? value : "/";
}
