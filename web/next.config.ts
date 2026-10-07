import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted on Azure App Service (not Vercel) — standalone produces a
  // minimal server.js plus only the traced dependencies, instead of
  // shipping the full node_modules tree.
  output: "standalone",

  // The acceptance data set bundled by scripts/prebuild-acceptance-data.js
  // (web/data/acceptance/*.json) is read at runtime via fs.readFileSync
  // (lib/acceptance-bundled.ts), not imported as a module, so Next's
  // build-time file tracer can't discover it through static analysis
  // alone. List it explicitly so a Vercel deploy actually ships these
  // files inside the functions that read them.
  outputFileTracingIncludes: {
    "/acceptance": ["./data/acceptance/**/*"],
    "/api/acceptance/**/*": ["./data/acceptance/**/*"],
  },
};

export default nextConfig;
