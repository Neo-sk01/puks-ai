import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { signEntraTicket, signFlowState, verifyEntraTicket, verifyFlowState } from "./entra-flow";

/** jose's own `jwtVerify` checks `exp` against wall-clock time, with no way
 *  to override "now" from outside this module's sign/verify wrappers — so
 *  to test expiry without a real 60-second sleep, decode the ticket's
 *  signature-verified payload directly and assert `exp` is in the past
 *  relative to a `currentDate` set just past it. */
async function expiresWithin(token: string, secret: string, seconds: number) {
  const key = new TextEncoder().encode(secret);
  const past = await jwtVerify(token, key, { currentDate: new Date(Date.now() + (seconds - 5) * 1000) });
  await expect(jwtVerify(token, key, { currentDate: new Date(Date.now() + (seconds + 5) * 1000) })).rejects.toThrow();
  return past;
}

const SECRET = "test-secret-do-not-use-in-prod";
const OTHER_SECRET = "a-different-secret";

describe("flow state (signin -> callback cookie)", () => {
  const data = { state: "s1", nonce: "n1", codeVerifier: "v1", callbackUrl: "/acceptance" };

  it("round-trips what was signed", async () => {
    const token = await signFlowState(SECRET, data);
    await expect(verifyFlowState(SECRET, token)).resolves.toEqual(data);
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signFlowState(OTHER_SECRET, data);
    await expect(verifyFlowState(SECRET, token)).resolves.toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await signFlowState(SECRET, data);
    const tampered = token.slice(0, -4) + "aaaa";
    await expect(verifyFlowState(SECRET, tampered)).resolves.toBeNull();
  });

  it("rejects garbage input", async () => {
    await expect(verifyFlowState(SECRET, "not-a-jwt")).resolves.toBeNull();
  });

  it("expires after 10 minutes", async () => {
    const token = await signFlowState(SECRET, data);
    await expiresWithin(token, SECRET, 10 * 60);
  });
});

describe("entra ticket (callback route -> Credentials provider)", () => {
  const claims = { oid: "user-oid-1", tid: "agl-tenant-id", name: "Donald", email: "donald@agl.example" };

  it("round-trips what was signed, for the expected tenant", async () => {
    const token = await signEntraTicket(SECRET, claims);
    await expect(verifyEntraTicket(SECRET, token, "agl-tenant-id")).resolves.toEqual(claims);
  });

  it("rejects a ticket for a different tenant than expected", async () => {
    const token = await signEntraTicket(SECRET, claims);
    await expect(verifyEntraTicket(SECRET, token, "some-other-tenant")).resolves.toBeNull();
  });

  it("rejects a token signed with a different secret (forged ticket)", async () => {
    const token = await signEntraTicket(OTHER_SECRET, claims);
    await expect(verifyEntraTicket(SECRET, token, "agl-tenant-id")).resolves.toBeNull();
  });

  it("rejects a tampered ticket", async () => {
    const token = await signEntraTicket(SECRET, claims);
    const tampered = token.slice(0, -4) + "aaaa";
    await expect(verifyEntraTicket(SECRET, tampered, "agl-tenant-id")).resolves.toBeNull();
  });

  it("optional claims are omitted, not null, when absent", async () => {
    const token = await signEntraTicket(SECRET, { oid: "u2", tid: "agl-tenant-id" });
    await expect(verifyEntraTicket(SECRET, token, "agl-tenant-id")).resolves.toEqual({
      oid: "u2",
      tid: "agl-tenant-id",
      name: undefined,
      email: undefined,
    });
  });

  it("expires after 60 seconds — short on purpose, this is a single-use handoff", async () => {
    const token = await signEntraTicket(SECRET, claims);
    await expiresWithin(token, SECRET, 60);
  });
});
