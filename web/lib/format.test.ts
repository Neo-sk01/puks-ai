import { describe, expect, it } from "vitest";
import { formatElapsed, metaString } from "./format";

describe("metaString", () => {
  it("returns string values", () => {
    expect(metaString({ source: "RECEIVING GOODS/reverse_grn.docx" }, "source")).toBe(
      "RECEIVING GOODS/reverse_grn.docx",
    );
  });

  it("returns an empty string for missing or non-string values", () => {
    expect(metaString({}, "source")).toBe("");
    expect(metaString({ source: 42 }, "source")).toBe("");
    expect(metaString({ source: null }, "source")).toBe("");
  });
});

describe("formatElapsed", () => {
  it("formats sub-second values in milliseconds", () => {
    expect(formatElapsed(640)).toBe("640 ms");
  });

  it("formats longer values in seconds with one decimal", () => {
    expect(formatElapsed(4120)).toBe("4.1 s");
  });

  it("returns undefined when there is nothing to show", () => {
    expect(formatElapsed(undefined)).toBeUndefined();
    expect(formatElapsed(Number.NaN)).toBeUndefined();
  });
});
