import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "./callback-url";

describe("safeCallbackUrl", () => {
  it("accepts a plain relative path", () => {
    expect(safeCallbackUrl("/acceptance")).toBe("/acceptance");
  });

  it("accepts a relative path with a query string", () => {
    expect(safeCallbackUrl("/acceptance?tab=summary")).toBe("/acceptance?tab=summary");
  });

  it("falls back to / for an absolute URL", () => {
    expect(safeCallbackUrl("https://evil.com")).toBe("/");
  });

  it("falls back to / for a protocol-relative URL", () => {
    expect(safeCallbackUrl("//evil.com")).toBe("/");
  });

  it("falls back to / for a bare host with no scheme", () => {
    expect(safeCallbackUrl("evil.com")).toBe("/");
  });

  it("falls back to / for undefined", () => {
    expect(safeCallbackUrl(undefined)).toBe("/");
  });

  it("falls back to / for an empty string", () => {
    expect(safeCallbackUrl("")).toBe("/");
  });

  it("takes the first value when given an array (repeated query param)", () => {
    expect(safeCallbackUrl(["/about", "/acceptance"])).toBe("/about");
  });

  it("falls back to / when the first array value is unsafe", () => {
    expect(safeCallbackUrl(["//evil.com", "/about"])).toBe("/");
  });
});
