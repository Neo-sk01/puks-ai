"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_HEIGHT = 208; // px — about eight lines before the box scrolls

/** The textarea stays usable while an answer streams, so a follow-up can be
 *  typed ahead; only *sending* is blocked. While streaming the send button
 *  becomes a Stop button. */
export function Composer({
  streaming,
  onSend,
  onStop,
}: {
  streaming: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Focus on load — but only where there's a physical keyboard; on a phone
  // this would throw the on-screen keyboard over the welcome screen.
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) ref.current?.focus();
  }, []);

  function resize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }

  function submit() {
    const text = value.trim();
    if (!text || streaming) return;
    setValue("");
    if (ref.current) ref.current.style.height = "auto";
    onSend(text);
  }

  const canSend = value.trim().length > 0 && !streaming;

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="rounded-2xl border border-rule bg-card shadow-soft transition focus-within:border-signal/50 focus-within:ring-4 focus-within:ring-signal/10"
      >
        <label htmlFor="composer" className="sr-only">
          Ask a question about Speed WMS
        </label>
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={value}
          placeholder="Ask anything about Speed WMS…"
          onChange={(e) => setValue(e.target.value)}
          onInput={resize}
          onKeyDown={(e) => {
            // isComposing: Enter confirms an IME candidate, it isn't "send".
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="scroll-thin block w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] text-type outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center justify-between gap-3 px-3 pb-2.5">
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            <kbd className="rounded border border-rule bg-bay px-1 font-mono">Enter</kbd> to send ·{" "}
            <kbd className="rounded border border-rule bg-bay px-1 font-mono">Shift</kbd>+
            <kbd className="rounded border border-rule bg-bay px-1 font-mono">Enter</kbd> for a new line
          </p>
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="ml-auto flex h-9 items-center gap-2 rounded-full border border-rule bg-bay px-3.5 text-sm font-medium text-type transition-colors hover:border-signal/50"
            >
              <Square className="size-3 fill-current" aria-hidden="true" />
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              className={cn(
                "ml-auto grid size-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-soft transition",
                "hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:opacity-35 disabled:shadow-none",
              )}
            >
              <ArrowUp className="size-[18px]" strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>
      <p className="text-center text-[11px] text-muted-foreground">
        Puks answers only from AGL&apos;s Speed WMS documentation. Review generated SQL before
        running it in production.
      </p>
    </div>
  );
}
