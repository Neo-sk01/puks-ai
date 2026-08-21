"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { NotReadyBanner } from "./NotReadyBanner";
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";
import { sendMessage } from "@/lib/chat";
import type { AppConfig, ChatMessage, Chunk, Health } from "@/lib/types";

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Welcome. I am Puks — your Speed WMS Retrieval-Augmented Intelligence System. How can I help you today?",
};

const RESET_NOTICE: ChatMessage = {
  role: "assistant",
  content: "Memory has been reset. You can start a new conversation now.",
};

const REFUSAL_TEXT =
  "I do not have enough information to answer this. Please contact support.";

/** metadata is `Record<string, unknown>` on the wire — narrow defensively
 *  rather than assuming the fixture/production shape holds forever. */
function metaString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];
  return typeof value === "string" ? value : "";
}

/** The fixed-field header strip: SOURCE · CATEGORY · REL 0.870. This is the
 *  WMS record header — it is why a support engineer can trust the SQL below
 *  before pasting it into production. Archivo uppercase for the labels,
 *  Plex Mono + tabular-nums for the number that gets compared across turns. */
function HeaderStrip({ chunk, confidence }: { chunk: Chunk; confidence: number }) {
  const source = metaString(chunk.metadata, "source");
  const category = metaString(chunk.metadata, "category");
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-display text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
      {source && <span>{source}</span>}
      {source && category && <span aria-hidden="true">·</span>}
      {category && <span>{category}</span>}
      {(source || category) && <span aria-hidden="true">·</span>}
      <span className="font-mono tabular-nums text-type">REL {confidence.toFixed(3)}</span>
    </p>
  );
}

/** The provenance rail — the signature element. A 2-3px bar in the left
 *  gutter of every assistant turn, running its full height:
 *
 *  - Refused turn: solid --color-hazard, the only colour in that turn.
 *  - Streaming, before the first token: a slow shimmer — gpt-5 reasons
 *    before its first output token, so this covers the dead air.
 *  - Otherwise: segmented into up to three stacked parts for the top
 *    chunk's retrievers (dense, bm25, exact) — lit in --color-signal,
 *    unlit in --color-rule.
 *
 *  Decorative only (aria-hidden); the header strip and caption already
 *  carry this information as text. */
function ProvenanceRail({
  message,
  isStreamingThis,
}: {
  message: ChatMessage;
  isStreamingThis: boolean;
}) {
  if (message.role !== "assistant") return null;

  if (message.refused) {
    return (
      <div aria-hidden="true" className="w-[2px] shrink-0 self-stretch rounded-full bg-hazard md:w-[3px]" />
    );
  }

  if (isStreamingThis && !message.content) {
    return (
      <div
        aria-hidden="true"
        className="w-[2px] shrink-0 animate-pulse self-stretch rounded-full bg-gradient-to-b from-rule via-signal to-rule md:w-[3px]"
      />
    );
  }

  const chunk = message.retrieved?.chunks?.[0];
  if (!chunk) return null;

  const segments: Array<[string, boolean]> = [
    ["dense", chunk.in_dense],
    ["bm25", chunk.in_bm25],
    ["exact", chunk.in_exact],
  ];

  return (
    <div
      aria-hidden="true"
      className="flex w-[2px] shrink-0 flex-col gap-[2px] self-stretch overflow-hidden rounded-full md:w-[3px]"
    >
      {segments.map(([key, lit]) => (
        <div key={key} className={lit ? "flex-1 bg-signal" : "flex-1 bg-rule"} />
      ))}
    </div>
  );
}

export function ChatView({ health, config }: { health: Health; config: AppConfig | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [topK, setTopK] = useState(config?.top_k_default ?? 5);
  const [debug, setDebug] = useState(false);
  const [streaming, setStreaming] = useState(false);

  async function handleSend(text: string) {
    const outgoing: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setStreaming(true);

    const update = (patch: Partial<ChatMessage>) =>
      setMessages((current) => {
        const next = [...current];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    await sendMessage({
      message: text,
      messages,
      topK,
      onRetrieved: (retrieved) => update({ retrieved }),
      onToken: (token) =>
        setMessages((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, content: last.content + token };
          return next;
        }),
      onDone: (done) => {
        // Refusal short-circuits before any token, so the bubble is still empty.
        update({ done, refused: done.refused, ...(done.refused ? { content: REFUSAL_TEXT } : {}) });
        setStreaming(false);
      },
      onError: (message) => {
        update({ content: `**Request failed.**\n\n\`\`\`\n${message}\n\`\`\``, refused: true });
        setStreaming(false);
      },
    });
  }

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <Sidebar
        config={config}
        topK={topK}
        onTopK={setTopK}
        debug={debug}
        onDebug={setDebug}
        onReset={() => setMessages([RESET_NOTICE])}
      />
      <main className="flex min-w-0 flex-1 flex-col gap-4 p-6">
        <NotReadyBanner health={health} />
        {health.ready && (
          <div className="mx-auto flex w-full min-w-0 max-w-[72ch] flex-1 flex-col gap-4">
            <div className="flex-1 space-y-6 overflow-y-auto pr-2">
              {messages.map((message, i) => {
                const isStreamingThis = streaming && i === messages.length - 1;
                const topChunk = message.retrieved?.chunks?.[0];

                const body = (
                  <>
                    {message.content ? (
                      <Markdown>{message.content}</Markdown>
                    ) : (
                      isStreamingThis && (
                        <p className="animate-pulse text-sm text-muted">
                          {message.retrieved ? "Generating…" : "Searching documentation…"}
                        </p>
                      )
                    )}
                    {message.done && (
                      <p className="text-xs text-muted">
                        {message.done.refused
                          ? `Refused — top relevance ${message.done.confidence?.toFixed(3)} is below the ${message.done.threshold?.toFixed(2)} threshold.`
                          : `Top relevance: ${message.retrieved?.confidence.toFixed(3)} · ${message.done.model}`}
                      </p>
                    )}
                  </>
                );

                return (
                  <article key={i} className="space-y-2">
                    <p className="font-display text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
                      {message.role === "user" ? "You" : "Puks"}
                    </p>
                    {message.role === "assistant" ? (
                      <div className="flex gap-3">
                        <ProvenanceRail message={message} isStreamingThis={isStreamingThis} />
                        <div className="min-w-0 flex-1 space-y-2">
                          {topChunk && (
                            <HeaderStrip chunk={topChunk} confidence={message.retrieved!.confidence} />
                          )}
                          {body}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">{body}</div>
                    )}
                  </article>
                );
              })}
            </div>
            <Composer disabled={streaming} onSend={handleSend} />
          </div>
        )}
      </main>
    </div>
  );
}
