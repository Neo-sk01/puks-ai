import { describe, expect, it } from "vitest";
import { filterSummary, normaliseTester, resultStatus, verdictLabel, type RecordedResult, type Summary } from "./acceptance";

const result = (over: Partial<RecordedResult>): RecordedResult => ({
  id: "R1", question: "q", asked: ["q"], answer: "some answer", refused: false, reason: null,
  threshold: 0.75, confidence: 0.9, top_source: "x.txt", top_category: "X", sources: [], elapsed_s: 1, error: null, ...over,
});

describe("normaliseTester", () => {
  it("trims, casefolds and collapses spaces like the API", () => {
    expect(normaliseTester("  NEO  Sekaleli ")).toBe("neo sekaleli");
  });
});

describe("verdictLabel", () => {
  it("maps API values to the three UI labels", () => {
    expect([verdictLabel("pass"), verdictLabel("partial"), verdictLabel("fail")]).toEqual(["PASS", "PART", "FAIL"]);
  });
});

describe("resultStatus", () => {
  it("classifies the recorded outcome", () => {
    expect(resultStatus(undefined)).toBe("none");
    expect(resultStatus(result({}))).toBe("answered");
    expect(resultStatus(result({ refused: true, reason: "below_threshold" }))).toBe("gated");
    expect(resultStatus(result({ answer: "I do not have enough information to answer this. Please contact support." }))).toBe("model-refused");
    expect(resultStatus(result({ reason: "self_description" }))).toBe("self");
    expect(resultStatus(result({ reason: "needs_context" }))).toBe("needs-context");
    expect(resultStatus(result({ error: "ReadTimeout" }))).toBe("error");
  });
});

describe("filterSummary", () => {
  const summary: Summary = {
    questions: {
      R1: { counts: { pass: 2, partial: 0, fail: 0 }, testers: ["A", "B"], disagreement: false },
      R2: { counts: { pass: 1, partial: 1, fail: 0 }, testers: ["A", "B"], disagreement: true },
      R3: { counts: { pass: 0, partial: 0, fail: 1 }, testers: ["A"], disagreement: false },
      R4: { counts: { pass: 0, partial: 0, fail: 0 }, testers: [], disagreement: false },
    },
    totals: { questions: 4, scored: 3, testers: 2, pass_rate: 0.6 },
  };
  const ids = ["R1", "R2", "R3", "R4"];
  it("keeps order and applies each filter", () => {
    expect(filterSummary(ids, summary, "all")).toEqual(ids);
    expect(filterSummary(ids, summary, "unscored")).toEqual(["R4"]);
    expect(filterSummary(ids, summary, "disagreements")).toEqual(["R2"]);
    expect(filterSummary(ids, summary, "failures")).toEqual(["R3"]);
  });
});
