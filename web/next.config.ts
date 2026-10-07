import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // output: "standalone" was tried for the Azure App Service deploy and
  // reverted — with it active, `next build` crashes prerendering the
  // synthesized /_global-error route (TypeError: Cannot read properties
  // of null (reading 'useContext')), reproduced across Next 16.2.12 and
  // 16.3.2, Turbopack and webpack, with and without a custom
  // global-error.tsx, and with a static vs. per-media-query viewport
  // export — output: "standalone" was the only common factor. The Azure
  // deploy instead ships the full build (node_modules included) and runs
  // `next start`, same as this plain `next build` already does here and
  // on Vercel.

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
