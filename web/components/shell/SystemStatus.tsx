import { ChevronDown, TriangleAlert } from "lucide-react";
import type { AppConfig } from "@/lib/types";
import { anyPublic, providerLabel, rerankEnvVar, roleLabel } from "@/lib/provider";
import { cn } from "@/lib/utils";

/** The sidebar's model-stack summary and the two operator-facing warnings
 *  that used to sit in the old sidebar. Collapsed by default: most people
 *  never need the deployment names, and the one thing they do need to notice —
 *  a missing rerank key that makes every query refuse — is a separate,
 *  always-visible alert. */
export function SystemStatus({ config }: { config: AppConfig }) {
  const rows: Array<[string, string, string]> = [
    ["Generation", config.chat_deployment, roleLabel("chat", config.providers.chat)],
    ["Embeddings", config.embed_deployment, roleLabel("embed", config.providers.embed)],
    ["Reranker", config.rerank_model, roleLabel("rerank", config.providers.rerank)],
  ];

  return (
    <div className="flex flex-col gap-2">
      {!config.rerank_configured && !config.mock && (
        <div
          role="alert"
          className="flex gap-2 rounded-xl border border-hazard/40 bg-hazard/10 p-3 text-xs text-hazard"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <p>
            <strong>{rerankEnvVar(config.providers.rerank)} is not set.</strong> Rerank scores
            fall back to 0.0, and confidence is read from that same field — so every query will
            be refused.
          </p>
        </div>
      )}

      <details className="group rounded-xl border border-rule bg-card text-xs shadow-soft">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2.5 [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              config.mock ? "bg-brand ring-[3px] ring-brand/30" : "bg-verdict-pass ring-[3px] ring-verdict-pass/25",
            )}
          />
          <span className="font-medium text-type">{config.mock ? "Mock mode" : "Connected"}</span>
          <span className="truncate text-muted-foreground" title={providerLabel(config.provider)}>
            {config.mock ? "fixtures" : providerLabel(config.provider)}
          </span>
          <ChevronDown
            className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>

        <div className="space-y-2 border-t border-rule px-3 py-2.5">
          <dl className="space-y-1.5">
            {rows.map(([label, model, where]) => (
              <div key={label} className="flex items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 text-right [overflow-wrap:anywhere]">
                  <code className="font-mono text-type">{model}</code>
                  <span className="ml-1.5 text-muted-foreground">· {where}</span>
                </dd>
              </div>
            ))}
          </dl>
          {config.mock ? (
            <p className="text-muted-foreground">Answers come from fixtures, not the model.</p>
          ) : (
            anyPublic(config.providers) && (
              <p className="text-signal">
                {config.providers.chat === "azure"
                  ? "Generation runs in AGL's Foundry; embeddings and rerank use public APIs."
                  : "Local dev — public OpenAI and Cohere APIs, not AGL's tenant."}
              </p>
            )
          )}
        </div>
      </details>
    </div>
  );
}
