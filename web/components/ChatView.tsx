"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, SquarePen } from "lucide-react";
import type { Session } from "next-auth";
import { toast } from "sonner";
import { AppShell } from "@/components/shell/AppShell";
import { Button } from "@/components/ui/button";
import { NotReadyBanner } from "./NotReadyBanner";
import { Composer } from "./Composer";
import { ChatSettings } from "./chat/ChatSettings";
import { EmptyState } from "./chat/EmptyState";
import { MessageItem } from "./chat/MessageItem";
import { sendMessage } from "@/lib/chat";
import type { AppConfig, ChatMessage, Health } from "@/lib/types";

const REFUSAL_TEXT =
  "I do not have enough information to answer this. Please contact support.";

const STOPPED_TEXT = "_Stopped before an answer was generated._";

/** Distance from the bottom, in px, within which the transcript keeps
 *  following new tokens. Scroll further up than this and it stops, so someone
 *  re-reading an earlier answer isn't yanked away mid-sentence. */
const STICK_THRESHOLD = 80;

export function ChatView({
  health,
  config,
  user,
}: {
  health: Health;
  config: AppConfig | null;
  user: NonNullable<Session["user"]>;
}) {
  // Empty until the first question: the welcome screen replaces the old
  // canned greeting bubble. promptHistory only walks user→assistant pairs, so
  // there is nothing here for it to skip.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [topK, setTopK] = useState(config?.top_k_default ?? 5);
  const [showSources, setShowSources] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [showJump, setShowJump] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  // Follow the stream: every token re-renders `messages`, and while the reader
  // is at the bottom this keeps the newest text in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [messages]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
    stickRef.current = nearBottom;
    setShowJump(!nearBottom);
  }

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  async function handleSend(text: string) {
    if (streaming) return;

    const outgoing: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setStreaming(true);
    stickRef.current = true; // sending is an explicit "take me to the answer"

    const controller = new AbortController();
    abortRef.current = controller;

    const update = (patch: Partial<ChatMessage>) =>
      setMessages((current) => {
        const next = [...current];
        next[next.length - 1] = { ...next[next.length - 1], ...patch };
        return next;
      });

    const fail = (message: string) => {
      update({ content: `**Request failed.**\n\n\`\`\`\n${message}\n\`\`\``, refused: true });
      setStreaming(false);
    };

    try {
      await sendMessage({
        message: text,
        messages,
        topK,
        signal: controller.signal,
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
        onError: fail,
      });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        // The reader pressed Stop. Keep whatever streamed so far; if nothing
        // had, mark the turn refused so it stays out of the prompt history.
        setMessages((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && !last.content) {
            next[next.length - 1] = { ...last, content: STOPPED_TEXT, refused: true };
          }
          return next;
        });
      } else {
        // A malformed SSE frame throws out of parseSSE; surface it in the
        // transcript rather than leaving a half-built turn.
        fail((error as Error).message);
      }
    } finally {
      // Covers every exit: a stream that closes with no `done` event, Stop,
      // and a throw out of parseSSE on malformed JSON. onDone/onError already
      // call this on the happy paths; setState is idempotent, so the double
      // call is harmless. Without it, a mid-stream drop would leave the
      // composer stuck in its Stop state until the page is reloaded.
      abortRef.current = null;
      setStreaming(false);
    }
  }

  function handleNewChat() {
    abortRef.current?.abort();
    setMessages([]);
    stickRef.current = true;
    setShowJump(false);
    toast("New conversation started", { description: "Puks has forgotten the earlier questions." });
  }

  const empty = messages.length === 0;

  return (
    <AppShell config={config} user={user} scroll={false}>
      <header className="flex shrink-0 items-center gap-3 border-b border-rule/70 bg-background/60 px-4 py-3 backdrop-blur md:px-6">
        <div className="min-w-0">
          <h1 className="font-display text-base font-semibold tracking-tight">Speed WMS assistant</h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            Answers grounded in AGL&apos;s documentation
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            className="h-9 gap-2 px-3"
            onClick={handleNewChat}
            disabled={empty && !streaming}
          >
            <SquarePen aria-hidden="true" />
            <span className="hidden sm:inline">New chat</span>
          </Button>
          <ChatSettings
            config={config}
            topK={topK}
            onTopK={setTopK}
            showSources={showSources}
            onShowSources={setShowSources}
          />
        </div>
      </header>

      {health.ready ? (
        <>
          <div className="relative min-h-0 flex-1">
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="scroll-thin h-full overflow-y-auto"
              // A region, not role="log": a log is implicitly aria-live, and a
              // screen reader would read out every streamed token. Completion
              // is announced once by the status node below instead. It is a
              // scroll container, so it must be keyboard-focusable.
              role="region"
              aria-label="Conversation"
              tabIndex={0}
            >
              {empty ? (
                <EmptyState onPick={handleSend} disabled={streaming} />
              ) : (
                <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 md:px-6">
                  {messages.map((message, i) => (
                    <MessageItem
                      key={i}
                      message={message}
                      streaming={streaming && i === messages.length - 1}
                      showSources={showSources}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Soft edge so scrolled content dissolves into the composer
             *  instead of being cut off by it. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-ink/90 to-transparent"
            />

            {showJump && (
              <button
                type="button"
                onClick={jumpToLatest}
                className="absolute bottom-4 left-1/2 flex -translate-x-1/2 animate-fade-in items-center gap-1.5 rounded-full border border-rule bg-card px-3.5 py-1.5 text-xs font-medium shadow-lift transition hover:border-signal/50"
              >
                <ArrowDown className="size-3.5" aria-hidden="true" />
                Jump to latest
              </button>
            )}
          </div>

          <p role="status" className="sr-only">
            {!streaming && messages.at(-1)?.role === "assistant" ? "Response complete" : ""}
          </p>

          <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2 pb-4 md:px-6">
            <Composer streaming={streaming} onSend={handleSend} onStop={() => abortRef.current?.abort()} />
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center overflow-y-auto p-6">
          <NotReadyBanner health={health} />
        </div>
      )}
    </AppShell>
  );
}
