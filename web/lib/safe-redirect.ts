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
 * Rejects anything that isn't a path starting with a single `/` — that
 * excludes absolute URLs (`https://...`, `//host/...`, which browsers
 * resolve as protocol-relative to the current scheme) and reduces every
 * failure to the same safe fallback.
 */
export function safeNextPath(raw: string | null, fallback = "/acceptance"): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return fallback;
}
