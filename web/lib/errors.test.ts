import { describe, expect, it } from "vitest";
import { extractDetail } from "./errors";

describe("extractDetail", () => {
  it("unwraps a FastAPI HTTPException body", () => {
    expect(extractDetail('{"detail":"Engine not ready"}', "fallback")).toBe("Engine not ready");
  });

  it("unwraps the real ConfigError text the index mismatch produces", () => {
    const raw = JSON.stringify({ detail: "Index is 384-dim but AZURE_EMBED_DIMENSIONS is 3072" });
    expect(extractDetail(raw, "fallback")).toBe("Index is 384-dim but AZURE_EMBED_DIMENSIONS is 3072");
  });

  it("never returns a string that still looks like a JSON envelope", () => {
    const out = extractDetail('{"detail":"Engine not ready"}', "fallback");
    expect(out).not.toContain('{"detail"');
  });

  it("passes plain text through unchanged", () => {
    expect(extractDetail("502 Bad Gateway", "fallback")).toBe("502 Bad Gateway");
  });

  it("passes an HTML error page through rather than throwing", () => {
    expect(extractDetail("<html><body>nginx</body></html>", "fallback")).toBe(
      "<html><body>nginx</body></html>",
    );
  });

  it("falls back on an empty or whitespace-only body", () => {
    expect(extractDetail("", "Service Unavailable")).toBe("Service Unavailable");
    expect(extractDetail("   \n ", "Service Unavailable")).toBe("Service Unavailable");
  });

  it("uses the raw body when JSON has no string detail", () => {
    expect(extractDetail('{"error":"nope"}', "fallback")).toBe('{"error":"nope"}');
    expect(extractDetail('{"detail":{"nested":true}}', "fallback")).toBe('{"detail":{"nested":true}}');
  });
});
