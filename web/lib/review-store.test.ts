import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isReviewKey, readReview, writeReview } from "./review-store";

describe("review store", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "puks-review-")); process.env.PUKS_REVIEW_DATA = dir; });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.PUKS_REVIEW_DATA; });

  it("returns the empty shape for a missing file", () => {
    expect(readReview("annotations")).toEqual([]);
    expect(readReview("samples")).toEqual({ ids: [] });
    expect(readReview("patterns")).toEqual({});
  });

  it("round-trips a write and leaves no temp file behind", () => {
    writeReview("annotations", [{ id: "a1", note: "wrong table" }]);
    expect(readReview("annotations")).toEqual([{ id: "a1", note: "wrong table" }]);
    expect(JSON.parse(readFileSync(path.join(dir, "annotations.json"), "utf-8"))).toHaveLength(1);
  });

  it("refuses to write the derived documents", () => {
    expect(() => writeReview("records", [])).toThrow(/not writable/);
    expect(() => writeReview("graph", [])).toThrow(/not writable/);
  });

  it("degrades to the empty shape on corrupt JSON rather than throwing", () => {
    writeFileSync(path.join(dir, "suggestions.json"), "{not json");
    expect(readReview("suggestions")).toEqual([]);
  });

  it("only accepts the six known keys", () => {
    expect(isReviewKey("annotations")).toBe(true);
    expect(isReviewKey("../etc/passwd")).toBe(false);
  });
});
