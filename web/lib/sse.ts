import type { ServerEvent } from "./types";

/**
 * Parse an SSE body into typed events.
 *
 * EventSource cannot POST, so the stream is read by hand. Events are separated
 * by a blank line; a network chunk can split one anywhere, so a buffer carries
 * the remainder between reads.
 */
export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<ServerEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        let name: string | null = null;
        let payload: string | null = null;

        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) name = line.slice(7);
          else if (line.startsWith("data: ")) payload = line.slice(6);
        }

        if (name && payload !== null) {
          yield { event: name, data: JSON.parse(payload) } as ServerEvent;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
