import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // App Service's B1 plan cannot complete `next build` — Oryx ran for over
  // twelve minutes and failed. The bundle is therefore built locally and
  // deployed prebuilt, which `standalone` makes possible: it emits
  // .next/standalone/server.js plus only the node_modules actually traced,
  // so the deployment artifact is megabytes rather than a full install.
  // Vercel ignores this setting and builds as it always has.
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
    "/review": ["./data/review/**/*"],
    "/api/review/**/*": ["./data/review/**/*"],
  },
};

export default nextConfig;
