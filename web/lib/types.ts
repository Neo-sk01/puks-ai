/** Mirrors puks_rag.WIRE_FIELDS. `structured_data` is deliberately absent. */
export interface Chunk {
  index: number;
  fusion_score: number;
  in_dense: boolean;
  in_bm25: boolean;
  in_exact: boolean;
  doc_type: string;
  relevance_score: number;
  metadata: Record<string, unknown>;
  text: string;
}

export interface Intent {
  is_schema: boolean;
  is_operational: boolean;
  is_sql: boolean;
  schema_hits: string[];
  operational_hits: string[];
}

export interface RetrievedPayload {
  chunks: Chunk[];
  confidence: number;
  intent: Intent;
}

export interface DonePayload {
  refused: boolean;
  reason?: string;
  confidence?: number;
  threshold?: number;
  model?: string;
  elapsed_ms?: number;
}

export type ServerEvent =
  | { event: "retrieved"; data: RetrievedPayload }
  | { event: "token"; data: { text: string } }
  | { event: "done"; data: DonePayload }
  | { event: "error"; data: { message: string } };

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Refused assistant turns are displayed but excluded from prompt history.
   *  Streamlit appended to messages unconditionally but only called
   *  memory.add_turn() on the non-refused branch. */
  refused?: boolean;
  retrieved?: RetrievedPayload;
  done?: DonePayload;
}

export interface AppConfig {
  chat_deployment: string;
  embed_deployment: string;
  rerank_model: string;
  top_k_default: number;
  top_k_min: number;
  top_k_max: number;
  confidence_threshold: number;
  rerank_configured: boolean;
  mock: boolean;
}

/** Lives here, not in lib/server.ts: client components need the type, and
 *  lib/server.ts is `import "server-only"`. A value import of it from a client
 *  component is a build error, and only `import type` erasure hides that. */
export interface Health {
  ready: boolean;
  mock: boolean;
  error: string | null;
  index: { dimension: number | null; ntotal: number | null; model: string | null };
  rerank_configured: boolean;
}
