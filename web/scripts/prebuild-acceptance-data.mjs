#!/usr/bin/env node

/**
 * Copies the acceptance data set — questions, recorded results and (if a
 * run has actually happened) its metadata — from the repo root's docs/
 * into web/data/acceptance/, so `next build` can bundle it as part of the
 * deploy. Vercel has no access to the repo root at runtime and no Python
 * service to ask, so lib/acceptance-bundled.ts reads these copies instead
 * of proxying to FastAPI when the app is running in standalone mode (see
 * lib/deployment.ts).
 *
 * Runs automatically before `next build` via npm/pnpm's "prebuild"
 * lifecycle hook (see package.json). Plain Node, no dependency — an ES
 * module so eslint's no-require-imports rule (which applies to this
 * project's .js files) doesn't need an exception carved out for it.
 *
 * Safe to rerun: it always makes the destination match the current source,
 * so running it twice in a row (or a hundred times) leaves the same files
 * behind. acceptance-run.json only exists after a real run of
 * SCRIPTS/run_acceptance.py — when it's missing upstream, the destination
 * gets a literal `null` placeholder instead of being skipped, so the
 * bundled file always exists for a static import to resolve.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SRC_DIR = path.join(ROOT, "docs");
const DEST_DIR = path.join(__dirname, "..", "data", "acceptance");

fs.mkdirSync(DEST_DIR, { recursive: true });

function copyRequired(name) {
  const src = path.join(SRC_DIR, name);
  if (!fs.existsSync(src)) {
    console.error(`[prebuild-acceptance-data] missing required file: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(DEST_DIR, name));
  console.log(`[prebuild-acceptance-data] copied ${name}`);
}

function copyOptionalRun(name) {
  const src = path.join(SRC_DIR, name);
  const dest = path.join(DEST_DIR, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[prebuild-acceptance-data] copied ${name}`);
  } else {
    fs.writeFileSync(dest, "null\n");
    console.log(`[prebuild-acceptance-data] ${name} not found upstream (no run recorded yet); wrote null placeholder`);
  }
}

copyRequired("acceptance-questions.json");
copyRequired("acceptance-results.json");
copyOptionalRun("acceptance-run.json");
