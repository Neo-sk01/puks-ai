import { VERDICTS, type Summary, type Verdict } from "../acceptance";

/**
 * Mirrors api/acceptance_store.py's normalise_tester exactly: trim, collapse
 * internal whitespace, lower-case. Two testers who type "Neo Sekaleli" and
 * "neo  sekaleli " must land on the same row — this is the primary-key half
 * that guarantees it, so it has to produce the same string as the Python
 * version for the same input.
 *
 * ('  NEO  Sekaleli ' -> 'neo sekaleli', matching the Python docstring's
 * example.)
 */
export function normaliseTester(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface VerdictRow {
  question_id: string;
  tester: string;
  tester_name: string;
  verdict: Verdict;
}

/**
 * Mirrors api/acceptance_store.py's Store.summary. A pure function over
 * plain rows — no database, no I/O — so it's testable on its own; postgres.ts
 * calls it on whatever `SELECT question_id, tester, tester_name, verdict
 * FROM verdict ORDER BY tester_name` returns.
 *
 * `disagreement` is true when a question has verdicts of more than one
 * kind. `pass_rate` is pass / (pass + partial + fail) over all verdicts, or
 * null when there are none. A row whose question_id isn't in `questionIds`
 * (a verdict for a question since removed from the set) is skipped, exactly
 * as the Python version does.
 */
export function aggregateSummary(rows: VerdictRow[], questionIds: string[]): Summary {
  const per: Summary["questions"] = {};
  for (const id of questionIds) {
    per[id] = { counts: { pass: 0, partial: 0, fail: 0 }, testers: [], disagreement: false };
  }

  const testers = new Set<string>();
  const totals: Record<Verdict, number> = { pass: 0, partial: 0, fail: 0 };

  for (const row of rows) {
    const entry = per[row.question_id];
    if (!entry) continue;
    testers.add(row.tester);
    entry.counts[row.verdict] += 1;
    entry.testers.push(row.tester_name);
    totals[row.verdict] += 1;
  }

  for (const entry of Object.values(per)) {
    entry.disagreement = VERDICTS.filter((v) => entry.counts[v] > 0).length > 1;
  }

  const n = totals.pass + totals.partial + totals.fail;
  return {
    questions: per,
    totals: {
      questions: questionIds.length,
      scored: Object.values(per).filter((e) => e.counts.pass + e.counts.partial + e.counts.fail > 0).length,
      testers: testers.size,
      pass_rate: n ? totals.pass / n : null,
    },
  };
}
