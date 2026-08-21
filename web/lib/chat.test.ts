import { describe, expect, it, vi } from "vitest";
import { sendMessage } from "./chat";

function sseStream(...frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
}

function stubFetch(stream: ReadableStream<Uint8Array>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
}

describe("sendMessage", () => {
  it("returns when the stream closes without a done event", async () => {
    // The dropped-connection case: retrieved and a token arrive, then the body
    // simply ends. sendMessage must resolve so the caller's finally can run.
    stubFetch(sseStream(
      'event: retrieved\ndata: {"chunks":[],"confidence":0.9,"intent":{}}\n\n',
      'event: token\ndata: {"text":"partial"}\n\n',
    ));
    const onDone = vi.fn();
    const onError = vi.fn();
    const tokens: string[] = [];

    await expect(sendMessage({
      message: "q", messages: [], topK: 5,
      onRetrieved: () => {}, onToken: (t) => tokens.push(t), onDone, onError,
    })).resolves.toBeUndefined();

    expect(tokens).toEqual(["partial"]);
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("dispatches events in order on a complete stream", async () => {
    stubFetch(sseStream(
      'event: retrieved\ndata: {"chunks":[],"confidence":0.87,"intent":{}}\n\n',
      'event: token\ndata: {"text":"a"}\n\n',
      'event: done\ndata: {"refused":false,"model":"gpt-5"}\n\n',
    ));
    const seen: string[] = [];
    await sendMessage({
      message: "q", messages: [], topK: 5,
      onRetrieved: () => seen.push("retrieved"),
      onToken: () => seen.push("token"),
      onDone: () => seen.push("done"),
      onError: () => seen.push("error"),
    });
    expect(seen).toEqual(["retrieved", "token", "done"]);
    vi.unstubAllGlobals();
  });

  it("reports a non-2xx body through onError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ detail: "Engine not ready" }), { status: 503 })));
    const onError = vi.fn();
    await sendMessage({
      message: "q", messages: [], topK: 5,
      onRetrieved: () => {}, onToken: () => {}, onDone: () => {}, onError,
    });
    expect(onError).toHaveBeenCalledWith("Engine not ready");
    vi.unstubAllGlobals();
  });
});
