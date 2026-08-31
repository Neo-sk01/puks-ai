#!/usr/bin/env node

/**
 * Copies the error-discovery review data — the 65 joined records, the map
 * projection and the initial sample — from evals/error-discovery/data/ into
 * web/data/review/, so `next build` can bundle it into the deploy. Vercel
 * has no access to the repo root at runtime, so lib/review-store.ts falls
 * back to these copies when the evals directory isn't there.
 *
 * Only the three prepare.py-derived documents are bundled. The mutable
 * documents (annotations, suggestions, patterns) live in Postgres on a
 * standalone deploy and are never baked into the build.
 *
 * Runs before `next build` via the "prebuild" lifecycle hook, after
 * prebuild-acceptance-data.mjs. Missing sources are not an error — a deploy
 * made before prepare.py has ever run just gets empty shapes, and /review
 * explains itself instead of crashing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SRC_DIR = path.join(ROOT, "evals", "error-discovery", "data");
const DEST_DIR = path.join(__dirname, "..", "data", "review");

fs.mkdirSync(DEST_DIR, { recursive: true });

const EMPTY = { "records.json": "[]", "graph.json": "[]", "samples.json": '{ "ids": [] }' };

for (const [name, empty] of Object.entries(EMPTY)) {
  const src = path.join(SRC_DIR, name);
  const dest = path.join(DEST_DIR, name);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[prebuild-review-data] copied ${name}`);
  } else {
    fs.writeFileSync(dest, empty + "\n");
    console.log(`[prebuild-review-data] ${name} not found upstream (run evals/error-discovery/prepare.py); wrote empty shape`);
  }
}
