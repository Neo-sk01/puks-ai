import { FASTAPI_URL } from "@/lib/server";
import { extractDetail } from "@/lib/errors";

/** Node runtime: the stream is passed through untouched and must not be
 *  buffered or transformed by the edge runtime. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.text();

  let upstream: Response;
  try {
    upstream = await fetch(`${FASTAPI_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `body` is a string, not a ReadableStream, so `duplex: "half"` is not
      // needed here — undici requires it only for streamed request bodies, and
      // `duplex` is absent from RequestInit in lib.dom.d.ts, @types/node and
      // Next's own global augmentation, so passing it would not type-check.
      // The RESPONSE is what streams; that needs nothing special on the request.
      body,
    });
  } catch (error) {
    return Response.json(
      { detail: `Cannot reach the API at ${FASTAPI_URL}: ${(error as Error).message}` },
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const raw = await upstream.text();
    return Response.json(
      { detail: extractDetail(raw, upstream.statusText) },
      { status: upstream.status },
    );
  }

  return new Response(upstream.body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
