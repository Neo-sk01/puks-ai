/**
 * Types for the error-discovery review tool (/review). The data is produced
 * by evals/error-discovery/prepare.py — one record per acceptance question,
 * joined to its answer key and to the corpus passages under each retrieved
 * source — and read/written through /api/review/[key].
 */

export type Segment = "question" | "key" | "retrieval" | "answer" | "sources";

export interface Excerpt {
  source_file: string;
  is_top: boolean;
  category: string | null;
  chunks: { chunk_type: string | null; text: string }[];
  n_chunks: number;
}

export interface ReviewRecord {
  id: string;
  group: string;
  group_title: string;
  kind: "answer" | "refuse";
  question: string;
  asked: string[];
  must_contain: string;
  expected_source: string;
  answer: string;
  refused: boolean;
  reason: "below_threshold" | "needs_context" | "self_description" | null;
  confidence: number | null;
  threshold: number | null;
  top_source: string | null;
  top_category: string | null;
  sources: string[];
  source_match: boolean | null;
  elapsed_s: number;
  error: string | null;
  flags: string[];
  excerpts: Excerpt[];
}

export interface Annotation {
  id: string;
  record_id: string;
  segment: Segment;
  /** The exact selected text, and which occurrence of it within the segment. */
  quote: string;
  occ: number;
  note: string;
  by: string;
  /** Set once the agent has grouped this note into a failure mode. */
  mode?: string;
  from_suggestion?: string;
  created_at: string;
}

export interface Suggestion {
  id: string;
  record_id: string;
  segment: Segment;
  quote: string;
  occ: number;
  mode: string;
  rationale?: string;
  status: "pending" | "accepted" | "dismissed";
}

export interface Pattern {
  description: string;
  count: number;
  example_ids: string[];
  example_quotes: string[];
  annotation_ids?: string[];
}
export type Patterns = Record<string, Pattern>;

export interface Samples { ids: string[]; note?: string }

export interface GraphPoint {
  id: string; x: number; y: number; cluster: number;
  group: string; kind: "answer" | "refuse"; refused: boolean;
  source_match: boolean | null; title: string;
}

export const REVIEWER_KEY = "puks.review.who";
export const SEEN_KEY = "puks.review.seen";

export const SEGMENT_LABEL: Record<Segment, string> = {
  question: "Question", key: "Answer key", retrieval: "What Puks found", answer: "Puks's answer", sources: "Source excerpts",
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
