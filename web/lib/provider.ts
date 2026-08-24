import type { Provider } from "./types";

/** Display helpers for the provider switch (puks_rag.PROVIDER). Safe in client
 *  components — no server imports. */
export function providerLabel(provider: Provider | undefined): string {
  switch (provider) {
    case "openai":
      return "OpenAI + Cohere (public)";
    case "azure":
      return "Azure AI Foundry";
    default:
      return "unknown";
  }
}

/** The variable the operator must set for reranking under each provider. */
export function rerankEnvVar(provider: Provider | undefined): string {
  return provider === "openai" ? "COHERE_API_KEY" : "AZURE_RERANK_ENDPOINT";
}
