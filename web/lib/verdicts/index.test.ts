import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * lib/deployment.ts's STANDALONE (and so lib/verdicts/index.ts's choice of
 * store) is a module-scope constant computed once from process.env at
 * import time — exactly so a request handler never re-checks it per call.
 * Testing both branches means resetting the module registry and
 * re-importing fresh after changing the env, rather than importing once at
 * the top of this file.
 */
describe("getVerdictsStore", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("picks the proxy store when neither POSTGRES_URL nor DATABASE_URL is set", async () => {
    delete process.env.POSTGRES_URL;
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { getVerdictsStore } = await import("./index");
    const { proxyStore } = await import("./proxy");
    await expect(getVerdictsStore()).resolves.toBe(proxyStore);
  });

  it("picks the postgres store when POSTGRES_URL is set", async () => {
    process.env.POSTGRES_URL = "postgres://user:pass@localhost:5432/db";
    delete process.env.DATABASE_URL;
    vi.resetModules();
    const { getVerdictsStore } = await import("./index");
    const { postgresStore } = await import("./postgres");
    await expect(getVerdictsStore()).resolves.toBe(postgresStore);
  });

  it("picks the postgres store when only DATABASE_URL is set", async () => {
    delete process.env.POSTGRES_URL;
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    vi.resetModules();
    const { getVerdictsStore } = await import("./index");
    const { postgresStore } = await import("./postgres");
    await expect(getVerdictsStore()).resolves.toBe(postgresStore);
  });

  it("prefers postgres over proxy when both env vars are set", async () => {
    process.env.POSTGRES_URL = "postgres://user:pass@localhost:5432/db";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/other";
    vi.resetModules();
    const { getVerdictsStore } = await import("./index");
    const { postgresStore } = await import("./postgres");
    await expect(getVerdictsStore()).resolves.toBe(postgresStore);
  });
});
