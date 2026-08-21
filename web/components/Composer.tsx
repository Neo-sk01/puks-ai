"use client";

import { useState } from "react";

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    setValue("");
    onSend(text);
  }

  return (
    <div className="flex gap-2 border-t border-rule pt-4">
      <textarea
        rows={1}
        value={value}
        disabled={disabled}
        placeholder="Ask anything about Speed WMS..."
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        className="min-h-11 flex-1 resize-none rounded-lg border border-rule bg-transparent px-3 py-2 text-type placeholder:text-muted disabled:opacity-50"
      />
      <button
        onClick={submit}
        disabled={disabled || !value.trim()}
        className="rounded-lg border border-rule px-4 text-type transition-colors hover:border-signal hover:text-signal disabled:pointer-events-none disabled:opacity-40"
      >
        Send
      </button>
    </div>
  );
}
