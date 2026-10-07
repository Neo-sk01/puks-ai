import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted on Azure App Service (not Vercel) — standalone produces a
  // minimal server.js plus only the traced dependencies, instead of
  // shipping the full node_modules tree (a full build's node_modules
  // zip hit Kudu's gateway timeout deploying to Azure — ~1.2GB is too
  // large for a direct zip-deploy). A `next build` crash prerendering
  // /_global-error was previously (and incorrectly) blamed on this
  // option — the actual cause was NODE_ENV=development leaking into the
  // build environment; see git history on this line for the misdiagnosis.
  // Vercel's own build pipeline does its own packaging and doesn't want
  // this — VERCEL=1 is set automatically during a Vercel build
  // (https://vercel.com/docs/environment-variables/system-environment-variables),
  // so only opt in when it's absent, i.e. everywhere except Vercel.
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),

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
