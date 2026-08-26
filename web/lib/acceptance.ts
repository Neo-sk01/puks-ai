/** Types mirror api/acceptance.py responses; helpers are pure so they test
 *  without a DOM. Keep normaliseTester identical to the Python
 *  normalise_tester — the two must agree on who is one tester. */

export type Verdict = "pass" | "partial" | "fail";

export interface AcceptanceQuestion {
  id: string; question: string; asked: string[]; must_contain: string; source: string; kind: "answer" | "refuse";
}
export interface QuestionGroup { key: string; title: string; note: string; questions: AcceptanceQuestion[] }
export interface RunMeta {
  ran_at: string; providers: Record<string, string>; chat_deployment: string | null;
  embed_deployment: string | null; rerank_model: string | null; threshold: number | null; count: number;
}
export interface RecordedResult {
  id: string; question: string; asked: string[]; answer: string; refused: boolean; reason: string | null;
  threshold: number | null; confidence: number | null; top_source: string | null; top_category: string | null;
  sources: string[]; elapsed_s: number; error: string | null;
}
export interface MyVerdict { verdict: Verdict; note: string; updated_at: string }
export interface QuestionSummary { counts: Record<Verdict, number>; testers: string[]; disagreement: boolean }
export interface Summary {
  questions: Record<string, QuestionSummary>;
  totals: { questions: number; scored: number; testers: number; pass_rate: number | null };
}
export type SummaryFilter = "all" | "unscored" | "disagreements" | "failures";
export type ResultStatus = "answered" | "gated" | "model-refused" | "self" | "needs-context" | "error" | "none";

export const TESTER_KEY = "puks-tester";
export const VERDICTS: Verdict[] = ["pass", "partial", "fail"];
const REFUSAL_PREFIX = "I do not have enough information to answer this.";

export function normaliseTester(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function verdictLabel(v: Verdict): "PASS" | "PART" | "FAIL" {
  return v === "pass" ? "PASS" : v === "partial" ? "PART" : "FAIL";
}

export function resultStatus(r: RecordedResult | undefined): ResultStatus {
  if (!r) return "none";
  if (r.error) return "error";
  if (r.refused) return "gated";
  if (r.reason === "self_description") return "self";
  if (r.reason === "needs_context") return "needs-context";
  if (r.answer.startsWith(REFUSAL_PREFIX)) return "model-refused";
  return "answered";
}

export function filterSummary(ids: string[], summary: Summary, filter: SummaryFilter): string[] {
  return ids.filter((id) => {
    const q = summary.questions[id];
    const scored = q ? q.counts.pass + q.counts.partial + q.counts.fail > 0 : false;
    switch (filter) {
      case "unscored": return !scored;
      case "disagreements": return !!q?.disagreement;
      case "failures": return (q?.counts.fail ?? 0) > 0;
      default: return true;
    }
  });
}
