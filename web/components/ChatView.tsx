"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { NotReadyBanner } from "./NotReadyBanner";
import type { AppConfig, ChatMessage, Health } from "@/lib/types";

const GREETING: ChatMessage = {
  role: "assistant",
  content:
    "Welcome. I am Puks — your Speed WMS Retrieval-Augmented Intelligence System. How can I help you today?",
};

const RESET_NOTICE: ChatMessage = {
  role: "assistant",
  content: "Memory has been reset. You can start a new conversation now.",
};

export function ChatView({ health, config }: { health: Health; config: AppConfig | null }) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [topK, setTopK] = useState(config?.top_k_default ?? 5);
  const [debug, setDebug] = useState(false);

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
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
        <NotReadyBanner health={health} />
        {health.ready && (
          <p className="text-sm text-muted">
            {messages.length} message(s) — chat panel arrives in Task 12
          </p>
        )}
      </main>
    </div>
  );
}
