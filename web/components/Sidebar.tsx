"use client";

import Image from "next/image";
import Link from "next/link";
import type { AppConfig } from "@/lib/types";
import { clampTopK } from "@/lib/history";
import { anyPublic, roleLabel, rerankEnvVar } from "@/lib/provider";

interface Props {
  config: AppConfig | null;
  topK: number;
  onTopK: (value: number) => void;
  debug: boolean;
  onDebug: (value: boolean) => void;
  onReset: () => void;
}

export function Sidebar({ config, topK, onTopK, debug, onDebug, onReset }: Props) {
  return (
    <aside className="flex w-full shrink-0 flex-col gap-4 border-b border-rule bg-bay p-4 md:h-dvh md:w-72 md:flex-col md:gap-6 md:border-b-0 md:border-r md:p-6">
      <div>
        {/* Client mark first, product second: Puks is AGL's tool. The PNG
         *  has its white knocked out, so it sits on the tinted sidebar. */}
        <Image
          src="/agl-logo.png"
          alt="AGL — Africa Global Logistics"
          width={428}
          height={235}
          priority
          className="mb-4 h-auto w-32"
        />
        <h1 className="font-display text-lg font-medium uppercase tracking-[0.04em]">
          Puks AI
        </h1>
        {/* The charter's title rule: a short AGL Yellow bar under the wordmark. */}
        <div aria-hidden="true" className="mt-1.5 mb-2 h-1 w-14 bg-brand" />
        <p className="text-sm text-muted-foreground">Enterprise Speed WMS Intelligence</p>
      </div>

      <nav className="flex flex-row gap-3 text-sm md:flex-col md:gap-1">
        <Link href="/" className="rounded px-2 py-1 hover:bg-rule/40 hover:text-signal">
          Chatbot
        </Link>
        <Link href="/about" className="rounded px-2 py-1 hover:bg-rule/40 hover:text-signal">
          About
        </Link>
      </nav>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Retrieval
        </h2>
        <label className="flex flex-col gap-1 text-sm">
          <span>Chunks passed to the model: {topK}</span>
          <input
            type="range"
            min={config?.top_k_min ?? 3}
            max={config?.top_k_max ?? 10}
            value={topK}
            onChange={(e) => onTopK(config ? clampTopK(Number(e.target.value), config) : Number(e.target.value))}
            className="accent-brand"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={debug}
            onChange={(e) => onDebug(e.target.checked)}
            className="accent-signal"
          />
          Show retrieved context
        </label>
      </section>

      {config && (
        <section className="flex flex-col gap-1 text-xs text-muted-foreground">
          <p>
            Generation <code className="font-mono text-type">{config.chat_deployment}</code>
            <span className="ml-1.5">· {roleLabel("chat", config.providers.chat)}</span>
          </p>
          <p>
            Embeddings <code className="font-mono text-type">{config.embed_deployment}</code>
            <span className="ml-1.5">· {roleLabel("embed", config.providers.embed)}</span>
          </p>
          <p>
            Reranker <code className="font-mono text-type">{config.rerank_model}</code>
            <span className="ml-1.5">· {roleLabel("rerank", config.providers.rerank)}</span>
          </p>
          {anyPublic(config.providers) && !config.mock && (
            <p className="text-signal">
              {config.providers.chat === "azure"
                ? "Generation runs in AGL's Foundry; embeddings and rerank use public APIs"
                : "Local dev — public OpenAI and Cohere APIs, not AGL's tenant"}
            </p>
          )}
          {config.mock && <p className="text-signal">Mock mode — fixtures, not the model</p>}
        </section>
      )}

      {config && !config.rerank_configured && !config.mock && (
        <p role="alert" className="rounded border border-hazard/40 bg-hazard/10 p-3 text-xs text-hazard">
          <strong>{rerankEnvVar(config.providers.rerank)} is not set.</strong> Rerank scores fall back to
          0.0, and confidence is read from that same field — so every query will be refused.
        </p>
      )}

      <button
        onClick={onReset}
        className="rounded border border-rule px-3 py-2 text-sm hover:border-signal hover:text-signal md:mt-auto"
      >
        Reset conversation memory
      </button>
      <p className="text-xs text-muted-foreground/60">© Puks AI (Predictive Unified Knowledge System)</p>
    </aside>
  );
}
