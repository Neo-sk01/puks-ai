import type { Provider, RoleProviders } from "./types";

/** Display helpers for the provider switch (puks_rag.PROVIDERS). Safe in
 *  client components — no server imports. */
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

/** Short per-role label: where a given role's calls actually go. */
export function roleLabel(role: keyof RoleProviders, provider: Provider): string {
  if (provider === "azure") return "Foundry";
  return role === "rerank" ? "Cohere" : "OpenAI";
}

/** True when any role leaves AGL's tenant. */
export function anyPublic(providers: RoleProviders | undefined): boolean {
  return !!providers && Object.values(providers).some((p) => p === "openai");
}

/** True when every role is on AGL's Foundry resource. */
export function allAzure(providers: RoleProviders | undefined): boolean {
  return !!providers && Object.values(providers).every((p) => p === "azure");
}

/** The variable the operator must set for reranking under each provider. */
export function rerankEnvVar(provider: Provider | undefined): string {
  return provider === "openai" ? "COHERE_API_KEY" : "AZURE_RERANK_ENDPOINT";
}
