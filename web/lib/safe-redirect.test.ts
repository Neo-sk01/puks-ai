import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("passes a normal relative path through", () => {
    expect(safeNextPath("/acceptance")).toBe("/acceptance");
    expect(safeNextPath("/acceptance?tab=summary")).toBe("/acceptance?tab=summary");
  });

  it("falls back to /acceptance for an absolute https URL (open redirect)", () => {
    expect(safeNextPath("https://evil.example")).toBe("/acceptance");
    expect(safeNextPath("http://evil.example/phish")).toBe("/acceptance");
  });

  it("falls back to /acceptance for a protocol-relative URL (open redirect)", () => {
    expect(safeNextPath("//evil.example")).toBe("/acceptance");
    expect(safeNextPath("//evil.example/phish")).toBe("/acceptance");
  });

  it("falls back for null, empty, or a path that doesn't start with /", () => {
    expect(safeNextPath(null)).toBe("/acceptance");
    expect(safeNextPath("")).toBe("/acceptance");
    expect(safeNextPath("acceptance")).toBe("/acceptance");
    expect(safeNextPath("javascript:alert(1)")).toBe("/acceptance");
  });

  it("honours a custom fallback", () => {
    expect(safeNextPath("https://evil.example", "/")).toBe("/");
  });
});
