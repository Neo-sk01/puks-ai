import { describe, expect, it } from "vitest";
import { aggregateSummary, normaliseTester, toPythonIsoString, type VerdictRow } from "./shared";

describe("normaliseTester", () => {
  it("matches api/acceptance_store.py's docstring example", () => {
    expect(normaliseTester("  NEO  Sekaleli ")).toBe("neo sekaleli");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normaliseTester("  Neo  ")).toBe("neo");
  });

  it("collapses internal runs of whitespace to one space", () => {
    expect(normaliseTester("Neo   Sekaleli")).toBe("neo sekaleli");
    expect(normaliseTester("Neo\tSekaleli\nSecond")).toBe("neo sekaleli second");
  });

  it("lower-cases", () => {
    expect(normaliseTester("NEO")).toBe("neo");
  });

  it("treats different spellings of one person as the same key", () => {
    expect(normaliseTester("Neo Sekaleli")).toBe(normaliseTester("neo  sekaleli"));
    expect(normaliseTester("Neo Sekaleli")).toBe(normaliseTester(" NEO SEKALELI "));
  });

  it("normalises an empty/whitespace-only name to the empty string", () => {
    expect(normaliseTester("")).toBe("");
    expect(normaliseTester("   ")).toBe("");
  });
});

describe("aggregateSummary", () => {
  const row = (over: Partial<VerdictRow>): VerdictRow => ({
    question_id: "R1", tester: "a", tester_name: "A", verdict: "pass", ...over,
  });

  it("zero-fills every question, even ones with no verdicts", () => {
    const summary = aggregateSummary([], ["R1", "R2"]);
    expect(summary.questions.R1).toEqual({ counts: { pass: 0, partial: 0, fail: 0 }, testers: [], disagreement: false });
    expect(summary.questions.R2).toEqual({ counts: { pass: 0, partial: 0, fail: 0 }, testers: [], disagreement: false });
    expect(summary.totals).toEqual({ questions: 2, scored: 0, testers: 0, pass_rate: null });
  });

  it("counts verdicts per question and collects tester display names", () => {
    const rows = [
      row({ question_id: "R1", tester: "a", tester_name: "A", verdict: "pass" }),
      row({ question_id: "R1", tester: "b", tester_name: "B", verdict: "pass" }),
    ];
    const summary = aggregateSummary(rows, ["R1"]);
    expect(summary.questions.R1.counts).toEqual({ pass: 2, partial: 0, fail: 0 });
    expect(summary.questions.R1.testers).toEqual(["A", "B"]);
    expect(summary.questions.R1.disagreement).toBe(false);
  });

  it("flags disagreement when a question has more than one kind of verdict", () => {
    const rows = [
      row({ question_id: "R1", tester: "a", tester_name: "A", verdict: "pass" }),
      row({ question_id: "R1", tester: "b", tester_name: "B", verdict: "fail" }),
    ];
    const summary = aggregateSummary(rows, ["R1"]);
    expect(summary.questions.R1.disagreement).toBe(true);
  });

  it("does not flag disagreement when multiple testers agree", () => {
    const rows = [
      row({ question_id: "R1", tester: "a", tester_name: "A", verdict: "fail" }),
      row({ question_id: "R1", tester: "b", tester_name: "B", verdict: "fail" }),
    ];
    expect(aggregateSummary(rows, ["R1"]).questions.R1.disagreement).toBe(false);
  });

  it("counts distinct normalised testers, not verdict rows", () => {
    const rows = [
      row({ question_id: "R1", tester: "a", tester_name: "A", verdict: "pass" }),
      row({ question_id: "R2", tester: "a", tester_name: "A", verdict: "fail" }),
    ];
    const summary = aggregateSummary(rows, ["R1", "R2"]);
    expect(summary.totals.testers).toBe(1);
    expect(summary.totals.scored).toBe(2);
  });

  it("computes pass_rate over all verdicts, or null when there are none", () => {
    expect(aggregateSummary([], ["R1"]).totals.pass_rate).toBeNull();
    const rows = [
      row({ question_id: "R1", verdict: "pass" }),
      row({ question_id: "R1", verdict: "partial" }),
      row({ question_id: "R1", verdict: "fail" }),
      row({ question_id: "R1", verdict: "fail" }),
    ];
    expect(aggregateSummary(rows, ["R1"]).totals.pass_rate).toBe(0.25);
  });

  it("skips a verdict for a question that's since been removed from the set", () => {
    const rows = [row({ question_id: "GONE", verdict: "pass" })];
    const summary = aggregateSummary(rows, ["R1"]);
    expect(summary.questions.GONE).toBeUndefined();
    expect(summary.totals.testers).toBe(0);
    expect(summary.totals.scored).toBe(0);
  });
});

describe("toPythonIsoString", () => {
  it("renders the UTC offset as +00:00, matching Python's isoformat(), not Z", () => {
    const date = new Date("2026-08-24T12:34:56.789Z");
    expect(toPythonIsoString(date)).toBe("2026-08-24T12:34:56.789+00:00");
  });

  it("never contains a Z suffix", () => {
    expect(toPythonIsoString(new Date())).not.toContain("Z");
  });
});
