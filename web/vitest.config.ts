import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["lib/**/*.test.ts"] },
  resolve: {
    alias: {
      // See test-stubs/server-only.ts: Next.js resolves this specifier
      // through its own bundled copy at build time, which Vitest doesn't
      // have access to.
      "server-only": path.resolve(__dirname, "test-stubs/server-only.ts"),
    },
  },
});
