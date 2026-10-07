import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-hosted on Azure App Service (not Vercel) — standalone produces a
  // minimal server.js plus only the traced dependencies, instead of
  // shipping the full node_modules tree. Vercel's own build pipeline does
  // its own packaging and doesn't want this — VERCEL=1 is set automatically
  // during a Vercel build (https://vercel.com/docs/environment-variables/system-environment-variables),
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
