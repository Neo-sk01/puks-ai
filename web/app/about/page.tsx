import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Ban,
  BookOpen,
  CircleCheck,
  Cpu,
  GitMerge,
  ListOrdered,
  MessageSquareWarning,
  ScanSearch,
  Search,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { AppShell } from "@/components/shell/AppShell";
import { PuksMark } from "@/components/shell/Brand";
import { requireSession } from "@/lib/auth-guard";
import { getConfig } from "@/lib/server";
import { allAzure, roleLabel } from "@/lib/provider";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "About" };

const CAN = [
  "Answer Speed WMS support questions from AGL's warehouse documentation",
  "Show the sources behind every answer",
  "Refuse, rather than guess, when the documentation doesn't cover a question",
];

const CANNOT = [
  "Query live warehouse data",
  "Answer outside the knowledge base",
  "Change any system — it is read-only by design",
];

/** Shares the app shell with the chat and acceptance pages, so the sidebar and
 *  theme switch are always in reach. The retrieval controls that used to live
 *  in the shared sidebar are chat-only now (the chat header's Settings menu),
 *  which is what freed this page to use the shell at all. */
export default async function About() {
  const session = await requireSession("/about");
  const config = await getConfig();

  const pipeline: Array<{ stage: string; model: string; scope: string; Icon: LucideIcon }> = [
    {
      stage: "Dense retrieval",
      model: config?.embed_deployment ?? "text-embedding-3-large",
      scope: "Semantic search over the full corpus.",
      Icon: ScanSearch,
    },
    {
      stage: "Lexical retrieval",
      model: "BM25",
      scope: "Keyword search over the full corpus, independently of the dense pass.",
      Icon: Search,
    },
    {
      stage: "Fusion",
      model: "Reciprocal Rank Fusion",
      scope: "Merges the dense, keyword and exact-name matches into one ranked list.",
      Icon: GitMerge,
    },
    {
      stage: "Reranking",
      model: config?.rerank_model ?? "Cohere-rerank-v4.0-pro",
      scope: "Re-scores the merged candidates. This relevance score is what decides whether Puks answers or refuses.",
      Icon: ListOrdered,
    },
    {
      stage: "Generation",
      model: config?.chat_deployment ?? "gpt-5",
      scope: "Writes the answer from the top-ranked sources only.",
      Icon: Sparkles,
    },
  ];

  return (
    <AppShell config={config} user={session.user}>
      <div className="mx-auto max-w-4xl space-y-12 px-4 py-8 md:px-8 md:py-12">
        <section className="relative overflow-hidden rounded-3xl border border-rule bg-card p-8 shadow-soft md:p-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-28 -right-24 size-80 rounded-full bg-brand/40 blur-3xl dark:bg-brand/10"
          />
          <div className="relative">
            <PuksMark className="size-14 text-2xl" />
            <p className="mt-6 font-display text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
              Predictive Unified Knowledge System
            </p>
            <h1 className="mt-2 max-w-2xl font-display text-3xl font-semibold tracking-tight text-balance md:text-5xl">
              Speed WMS answers, grounded in AGL&apos;s own documentation.
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-pretty text-muted-foreground">
              <strong className="font-semibold text-type">Puks AI</strong> answers Speed WMS support
              questions from AGL&apos;s warehouse documentation. It answers only from documents it
              retrieves, and refuses rather than guessing.
            </p>
            {process.env.NEXT_PUBLIC_ACCEPTANCE_ONLY !== "1" && (
              <Link
                href="/"
                className="mt-7 inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-soft transition hover:brightness-110"
              >
                Start a conversation
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            )}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="font-display text-2xl font-semibold tracking-tight">How an answer is made</h2>
          <ol className="space-y-3">
            {pipeline.map(({ stage, model, scope, Icon }, i) => (
              <li
                key={stage}
                className="flex items-start gap-4 rounded-2xl border border-rule bg-card p-4 shadow-soft"
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-bay text-signal">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="font-display font-semibold">{stage}</h3>
                    <code className="rounded-md bg-bay px-1.5 py-0.5 font-mono text-xs text-type">{model}</code>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{scope}</p>
                </div>
                <span className="font-mono text-xs text-muted-foreground tabular-nums" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-rule bg-card p-6 shadow-soft">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <ShieldCheck className="size-5 text-verdict-pass" aria-hidden="true" />
              What it does
            </h2>
            <ul className="mt-4 space-y-3 text-sm">
              {CAN.map((item) => (
                <li key={item} className="flex gap-3">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-verdict-pass" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-rule bg-card p-6 shadow-soft">
            <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
              <Ban className="size-5 text-muted-foreground" aria-hidden="true" />
              What it cannot do
            </h2>
            <ul className="mt-4 space-y-3 text-sm">
              {CANNOT.map((item) => (
                <li key={item} className="flex gap-3">
                  <Ban className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="flex gap-4 rounded-2xl border border-rule bg-bay p-5">
          <Cpu className="mt-0.5 size-5 shrink-0 text-signal" aria-hidden="true" />
          {config && !allAzure(config.providers) ? (
            <p className="text-sm">
              On this instance, generation runs on{" "}
              <strong>{roleLabel("chat", config.providers.chat)}</strong>, embeddings on{" "}
              <strong>{roleLabel("embed", config.providers.embed)}</strong> and reranking on{" "}
              <strong>{roleLabel("rerank", config.providers.rerank)}</strong>. AGL&apos;s Foundry
              resource currently deploys gpt-5 only, so the embedding and rerank calls reach the
              public OpenAI and Cohere APIs with the same models. Once those are deployed in the
              tenant, no request will leave it.
            </p>
          ) : (
            <p className="text-sm">
              Everything runs on AGL&apos;s own Azure Foundry resource. No request leaves the tenant.
            </p>
          )}
        </section>

        <section className="flex gap-4 rounded-2xl border border-signal/25 bg-signal/10 p-5">
          <MessageSquareWarning className="mt-0.5 size-5 shrink-0 text-signal" aria-hidden="true" />
          <p className="text-sm">
            <strong className="font-semibold">Found a wrong or missing answer?</strong> Raise it with
            the Speed WMS support team — resolved tickets are the highest-value source for improving
            this knowledge base.
          </p>
        </section>

        <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <BookOpen className="size-3.5" aria-hidden="true" />
          Puks answers only from documents it retrieves.
        </p>
      </div>
    </AppShell>
  );
}
