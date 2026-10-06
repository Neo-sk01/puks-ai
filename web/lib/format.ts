/** `metadata` is `Record<string, unknown>` on the wire — narrow defensively
 *  rather than assuming the fixture/production shape holds forever. */
export function metaString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
}

/** 4120 → "4.1 s". Undefined stays undefined so callers can skip the segment. */
export function formatElapsed(ms: number | undefined): string | undefined {
  if (ms == null || Number.isNaN(ms)) return undefined;
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
