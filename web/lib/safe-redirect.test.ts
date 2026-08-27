import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("passes a normal relative path through", () => {
    expect(safeNextPath("/acceptance")).toBe("/acceptance");
    expect(safeNextPath("/acceptance?tab=summary")).toBe("/acceptance?tab=summary");
  });

  it("preserves a query string and fragment intact", () => {
    expect(safeNextPath("/acceptance?tab=summary#R12")).toBe("/acceptance?tab=summary#R12");
  });

  it("falls back to /acceptance for an absolute https URL (open redirect)", () => {
    expect(safeNextPath("https://evil.example")).toBe("/acceptance");
    expect(safeNextPath("http://evil.example/phish")).toBe("/acceptance");
  });

  it("falls back to /acceptance for a protocol-relative URL (open redirect)", () => {
    expect(safeNextPath("//evil.example")).toBe("/acceptance");
    expect(safeNextPath("//evil.example/phish")).toBe("/acceptance");
  });

  it("falls back for a backslash host-confusion payload (WHATWG treats \\ as a path separator alias)", () => {
    // A single leading backslash: browsers resolve `/\evil.example`
    // exactly like `//evil.example` for special schemes.
    expect(safeNextPath("/\\evil.example")).toBe("/acceptance");
  });

  it("falls back for a double-backslash host-confusion payload", () => {
    expect(safeNextPath("/\\\\evil.example")).toBe("/acceptance");
  });

  it("falls back for the backslash payload after query-string decoding", () => {
    // What web/proxy.ts / app/unlock/page.tsx actually see once the
    // browser decodes `?next=%2F%5Cevil.example`.
    const decoded = new URLSearchParams("next=%2F%5Cevil.example").get("next");
    expect(decoded).toBe("/\\evil.example");
    expect(safeNextPath(decoded)).toBe("/acceptance");
  });

  it("falls back for a javascript: URL", () => {
    expect(safeNextPath("javascript:alert(1)")).toBe("/acceptance");
  });

  it("falls back for null, empty, or a path that doesn't start with /", () => {
    expect(safeNextPath(null)).toBe("/acceptance");
    expect(safeNextPath("")).toBe("/acceptance");
    expect(safeNextPath("acceptance")).toBe("/acceptance");
  });

  it("honours a custom fallback", () => {
    expect(safeNextPath("https://evil.example", "/")).toBe("/");
    expect(safeNextPath("/\\evil.example", "/")).toBe("/");
  });
});
