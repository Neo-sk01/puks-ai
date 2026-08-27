import { describe, expect, it } from "vitest";
import { constantTimeEqual } from "./access-code";

describe("constantTimeEqual", () => {
  it("is true for identical strings", () => {
    expect(constantTimeEqual("open-sesame", "open-sesame")).toBe(true);
  });

  it("is false for a wrong guess of the same length", () => {
    expect(constantTimeEqual("open-sesame", "open-sesamf")).toBe(false);
  });

  it("is false when the lengths differ, without throwing", () => {
    expect(constantTimeEqual("short", "a-lot-longer")).toBe(false);
    expect(constantTimeEqual("a-lot-longer", "short")).toBe(false);
  });

  it("is false when one side is empty", () => {
    expect(constantTimeEqual("", "code")).toBe(false);
    expect(constantTimeEqual("code", "")).toBe(false);
  });

  it("is true when both sides are empty", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(constantTimeEqual("Code123", "code123")).toBe(false);
  });

  it("handles multi-byte characters without throwing", () => {
    expect(constantTimeEqual("pässwörd", "pässwörd")).toBe(true);
    expect(constantTimeEqual("pässwörd", "password")).toBe(false);
  });
});
