import "server-only";
import { FASTAPI_URL } from "./server";
import { extractDetail } from "./errors";

/** Forward a request to FastAPI and hand the JSON (or the JSON error) back
 *  with the upstream status. The browser only ever sees the Next origin. */
export async function proxyJson(path: string, init?: RequestInit): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(`${FASTAPI_URL}${path}`, { cache: "no-store", ...init });
  } catch (error) {
    return Response.json(
      { detail: `Cannot reach the API at ${FASTAPI_URL}: ${(error as Error).message}` },
      { status: 502 },
    );
  }
  const raw = await upstream.text();
  if (!upstream.ok) {
    return Response.json({ detail: extractDetail(raw, upstream.statusText) }, { status: upstream.status });
  }
  return new Response(raw, { status: 200, headers: { "content-type": "application/json" } });
}
