import "server-only";

/**
 * Azure App Service (like most reverse proxies) terminates TLS and forwards
 * to the Node process over plain HTTP on an internal bind address —
 * `request.url`'s host then reflects that internal address (e.g.
 * `0.0.0.0:8080`), not the public hostname, which breaks anything that
 * needs an exact, externally-reachable redirect URI (Entra's redirect_uri
 * must match byte-for-byte between the authorize and token requests).
 * The proxy sets X-Forwarded-Host/X-Forwarded-Proto with the real values;
 * trusted here because only the platform's own proxy sits in front of this
 * route, not arbitrary internet traffic reaching the Node process directly.
 */
export function publicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (!forwardedHost) return new URL(request.url).origin;
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${forwardedProto}://${forwardedHost}`;
}
