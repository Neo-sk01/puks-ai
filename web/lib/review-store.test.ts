import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The file-backed path is what these tests exercise; the Postgres branch
// only turns on when POSTGRES_URL/DATABASE_URL is set (lib/deployment.ts).
vi.mock("./deployment", () => ({ STANDALONE: false }));

import { isReviewKey, readReview, writeReview } from "./review-store";

describe("review store (file-backed)", () => {
  let dir: string;
  let bundled: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "puks-review-"));
    bundled = mkdtempSync(path.join(tmpdir(), "puks-review-bundled-"));
    process.env.PUKS_REVIEW_DATA = dir;
    process.env.PUKS_REVIEW_BUNDLED = bundled;
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bundled, { recursive: true, force: true });
    delete process.env.PUKS_REVIEW_DATA;
    delete process.env.PUKS_REVIEW_BUNDLED;
  });

  it("returns the empty shape for a missing file", async () => {
    expect(await readReview("annotations")).toEqual([]);
    expect(await readReview("samples")).toEqual({ ids: [] });
    expect(await readReview("patterns")).toEqual({});
  });

  it("round-trips a write and leaves no temp file behind", async () => {
    await writeReview("annotations", [{ id: "a1", note: "wrong table" }]);
    expect(await readReview("annotations")).toEqual([{ id: "a1", note: "wrong table" }]);
    expect(JSON.parse(readFileSync(path.join(dir, "annotations.json"), "utf-8"))).toHaveLength(1);
  });

  it("refuses to write the derived documents", async () => {
    await expect(writeReview("records", [])).rejects.toThrow(/not writable/);
    await expect(writeReview("graph", [])).rejects.toThrow(/not writable/);
  });

  it("degrades to the empty shape on corrupt JSON rather than throwing", async () => {
    writeFileSync(path.join(dir, "suggestions.json"), "{not json");
    expect(await readReview("suggestions")).toEqual([]);
  });

  it("falls back to the bundled copy of a derived document when the local file is absent", async () => {
    writeFileSync(path.join(bundled, "records.json"), JSON.stringify([{ id: "R1" }]));
    expect(await readReview("records")).toEqual([{ id: "R1" }]);
    // ...but the local file wins when both exist.
    writeFileSync(path.join(dir, "records.json"), JSON.stringify([{ id: "R2" }]));
    expect(await readReview("records")).toEqual([{ id: "R2" }]);
  });

  it("only accepts the six known keys", () => {
    expect(isReviewKey("annotations")).toBe(true);
    expect(isReviewKey("../etc/passwd")).toBe(false);
  });
});
