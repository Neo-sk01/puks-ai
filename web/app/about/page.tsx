import Image from "next/image";
import Link from "next/link";

import { getConfig } from "@/lib/server";
import { allAzure, roleLabel } from "@/lib/provider";

export const dynamic = "force-dynamic";

/** Standalone page, not wrapped in the Sidebar shell: Sidebar is a client
 *  component whose props are all live chat state (topK, debug, onReset).
 *  Rendering it here would mean dummy handlers driving controls that do
 *  nothing. Tokens and fonts still apply — both are set globally in
 *  app/layout.tsx and app/globals.css, so this page inherits them without
 *  the sidebar and does not read as orphaned. */
export default async function About() {
  const config = await getConfig();

  const pipeline: Array<[string, string, string]> = [
    ["Dense retrieval", config?.embed_deployment ?? "text-embedding-3-large", "over the full corpus"],
    ["Lexical retrieval", "BM25", "over the full corpus, independently"],
    ["Fusion", "Reciprocal Rank Fusion", "—"],
    ["Reranking", config?.rerank_model ?? "Cohere-rerank-v4.0-pro", "—"],
    ["Generation", config?.chat_deployment ?? "gpt-5", "—"],
  ];

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-10">
      <div>
        <Link href="/" className="text-sm text-muted hover:text-type">
          ← Back to chat
        </Link>
        <Image
          src="/agl-logo.png"
          alt="AGL — Africa Global Logistics"
          width={428}
          height={235}
          className="mt-6 h-auto w-28"
        />
        <h1 className="mt-4 text-2xl font-semibold">About Puks AI</h1>
        <div aria-hidden="true" className="mt-2 h-1 w-14 bg-brand" />
      </div>

      <p className="text-type">
        <strong>Puks AI</strong> — Predictive Unified Knowledge System — answers Speed WMS support
        questions from AGL&apos;s warehouse documentation. It answers only from documents it
        retrieves, and refuses rather than guessing.
      </p>

      <section className="space-y-3">
        <h2 className="font-display text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
          Pipeline
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-muted">
                <th className="py-2 pr-4 font-medium">Stage</th>
                <th className="py-2 pr-4 font-medium">Model</th>
                <th className="py-2 font-medium">Scope</th>
              </tr>
            </thead>
            <tbody>
              {pipeline.map(([stage, model, scope]) => (
                <tr key={stage} className="border-b border-rule/50">
                  <td className="py-2 pr-4">{stage}</td>
                  <td className="py-2 pr-4">
                    <code className="font-mono text-type">{model}</code>
                  </td>
                  <td className="py-2 text-muted">{scope}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {config && !allAzure(config.providers) ? (
        <p className="rounded-lg border border-signal/30 bg-signal/10 p-4 text-sm text-signal">
          On this instance, generation runs on{" "}
          <strong>{roleLabel("chat", config.providers.chat)}</strong>, embeddings on{" "}
          <strong>{roleLabel("embed", config.providers.embed)}</strong> and reranking on{" "}
          <strong>{roleLabel("rerank", config.providers.rerank)}</strong>. AGL&apos;s Foundry resource
          currently deploys gpt-5 only, so the embedding and rerank calls reach the public OpenAI
          and Cohere APIs with the same models. Once those are deployed in the tenant, no request
          will leave it.
        </p>
      ) : (
        <p className="text-type">
          Everything runs on AGL&apos;s own Azure Foundry resource. No request leaves the tenant.
        </p>
      )}

      <p className="text-type">
        <strong>It cannot</strong> query live warehouse data, answer outside the knowledge base, or
        change any system. It is read-only by design.
      </p>

      <p className="rounded-lg border border-signal/30 bg-signal/10 p-4 text-sm text-signal">
        Found a wrong or missing answer? Raise it with the Speed WMS support team — resolved
        tickets are the highest-value source for improving this knowledge base.
      </p>
    </main>
  );
}
