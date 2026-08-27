/**
 * Validates a post-unlock redirect target. web/app/unlock/page.tsx reads
 * `next` off the query string and navigates there on a correct code — an
 * attacker-controlled `?next=` is otherwise an open redirect on exactly the
 * page testers are told to trust with a credential: `/unlock?next=
 * https://evil.example` would send them off-site immediately after
 * entering the access code, on success, so it reads as part of the flow.
 *
 * Only a same-origin path is safe here — `web/proxy.ts` (the only other
 * place that writes `next=`) always sets it from `request.nextUrl.pathname`,
 * which is already exactly that, but the query string is still
 * attacker-visible/rewritable in the browser, so this validates it again on
 * read rather than trusting the writer.
 *
 * A naive prefix check (reject leading `//`, reject anything not starting
 * with `/`) is NOT enough: per the WHATWG URL parsing algorithm that every
 * major browser implements, a backslash is a path-separator alias for
 * special schemes (http/https/etc.), so `/\evil.example` and
 * `/\\evil.example` are resolved exactly like `//evil.example` —
 * protocol-relative, i.e. a different host — even though they pass a
 * `startsWith("/") && !startsWith("//")` check. Enumerating hostile
 * prefixes is a losing game (there could be others browsers normalise
 * this way), so instead this resolves the candidate against a fixed,
 * unresolvable dummy origin using the platform's own `URL` class — the
 * same algorithm a browser uses to turn `next` into an actual navigation —
 * and only accepts the result if the resolved origin is unchanged. That
 * makes host-confusion tricks self-defeating: anything that would make the
 * browser leave `tool.invalid` also makes this function reject it.
 */
const PROBE_ORIGIN = "https://tool.invalid";

export function safeNextPath(raw: string | null, fallback = "/acceptance"): string {
  // Cheap shape check first: rejects absolute URLs (`https://...`),
  // scheme-relative junk (`javascript:...`), and bare strings with no
  // leading slash (`acceptance`) before ever constructing a URL.
  if (!raw || !raw.startsWith("/")) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(raw, PROBE_ORIGIN);
  } catch {
    return fallback;
  }

  // The load-bearing check: if resolving `raw` against the dummy origin
  // produced a different origin, `raw` was never a same-origin path to
  // begin with — regardless of which separator or encoding trick got it
  // there. Rebuilt from the parsed URL (not `raw` itself) so the returned
  // value is exactly what a real navigation would target: path + search +
  // hash, normalised.
  if (resolved.origin !== PROBE_ORIGIN) return fallback;
  return `${resolved.pathname}${resolved.search}${resolved.hash}`;
}
