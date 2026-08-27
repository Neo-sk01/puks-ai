import { describe, expect, it } from "vitest";
import { noStore } from "./no-store";

describe("noStore", () => {
  it("sets Cache-Control to private, no-store", () => {
    const response = noStore(Response.json({ ok: true }));
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("sets Vary to Cookie", () => {
    const response = noStore(Response.json({ ok: true }));
    expect(response.headers.get("Vary")).toBe("Cookie");
  });

  it("preserves the status code it is given", () => {
    const ok = noStore(Response.json({ ok: true }, { status: 200 }));
    const notFound = noStore(Response.json({ detail: "not found" }, { status: 404 }));
    const unauthorized = noStore(Response.json({ detail: "access code required" }, { status: 401 }));
    expect(ok.status).toBe(200);
    expect(notFound.status).toBe(404);
    expect(unauthorized.status).toBe(401);
  });

  it("preserves the JSON body it is given, for a success response", async () => {
    const body = { verdicts: [{ id: "q1", verdict: "pass" }] };
    const response = noStore(Response.json(body));
    await expect(response.json()).resolves.toEqual(body);
  });

  it("preserves the JSON body it is given, for an error response", async () => {
    const body = { detail: "tester is required" };
    const response = noStore(Response.json(body, { status: 400 }));
    await expect(response.json()).resolves.toEqual(body);
  });

  it("returns the same response object it was given, not a copy", () => {
    const response = Response.json({ ok: true });
    expect(noStore(response)).toBe(response);
  });

  it("does not clobber other headers already set on the response", () => {
    const response = noStore(new Response("{}", { headers: { "content-type": "application/json" } }));
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});
