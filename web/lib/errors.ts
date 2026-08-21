/**
 * Pull a human-readable message out of an upstream error body.
 *
 * FastAPI serialises HTTPException as {"detail": "..."}. Re-wrapping that whole
 * body as a new `detail` value would double-encode it, and the client renders
 * `detail` verbatim — the user would see {"detail":"..."} in the chat bubble.
 */
export function extractDetail(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return fallback;

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && typeof parsed.detail === "string") {
      return parsed.detail;
    }
  } catch {
    // Not JSON — an HTML error page, a proxy's plain-text message. Use it as-is.
  }

  return trimmed;
}
