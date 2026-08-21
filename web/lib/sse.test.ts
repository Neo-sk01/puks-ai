import { describe, expect, it } from "vitest";
import { parseSSE } from "./sse";

function streamOf(...pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const event of parseSSE(stream)) out.push(event);
  return out;
}

describe("parseSSE", () => {
  it("parses a complete event", async () => {
    const events = await collect(streamOf('event: token\ndata: {"text":"hi"}\n\n'));
    expect(events).toEqual([{ event: "token", data: { text: "hi" } }]);
  });

  it("parses several events in one chunk", async () => {
    const events = await collect(
      streamOf('event: token\ndata: {"text":"a"}\n\nevent: token\ndata: {"text":"b"}\n\n'),
    );
    expect(events.map((e) => e.data)).toEqual([{ text: "a" }, { text: "b" }]);
  });

  it("reassembles an event split across network chunks", async () => {
    const events = await collect(streamOf('event: tok', 'en\ndata: {"te', 'xt":"split"}\n\n'));
    expect(events).toEqual([{ event: "token", data: { text: "split" } }]);
  });

  it("handles a payload containing blank lines", async () => {
    const events = await collect(streamOf('event: token\ndata: {"text":"a\\n\\nb"}\n\n'));
    expect(events[0].data).toEqual({ text: "a\n\nb" });
  });

  it("ignores a trailing partial event", async () => {
    const events = await collect(streamOf('event: token\ndata: {"text":"ok"}\n\nevent: tok'));
    expect(events).toHaveLength(1);
  });

  it("preserves event order across types", async () => {
    const events = await collect(
      streamOf(
        'event: retrieved\ndata: {"chunks":[],"confidence":0.9,"intent":{}}\n\n',
        'event: token\ndata: {"text":"x"}\n\n',
        'event: done\ndata: {"refused":false}\n\n',
      ),
    );
    expect(events.map((e) => e.event)).toEqual(["retrieved", "token", "done"]);
  });
});
