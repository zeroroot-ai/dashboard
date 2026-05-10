#!/usr/bin/env node
/**
 * Build guard: verify that src/lib/billing/stripe_gen.ts is in sync with
 * plans.yaml. Spec plans-and-quotas-simplification R3.3 / R8.
 *
 * Drives gen-stripe-tiers.mjs --stdout and diffs against the committed
 * file. Non-zero exit on drift.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "check-stripe-tiers-fresh.mjs";
const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, "..");
const COMMITTED = resolve(DASHBOARD_ROOT, "src/lib/billing/stripe_gen.ts");
const GENERATOR = resolve(__dirname, "gen-stripe-tiers.mjs");

if (process.env.SKIP_STRIPE_TIERS_FRESH_CHECK === "1") {
  process.stdout.write(`[${SCRIPT_NAME}] SKIPPED\n`);
  process.exit(0);
}

let committed;
try {
  committed = readFileSync(COMMITTED, "utf8");
} catch (err) {
  process.stderr.write(`[${SCRIPT_NAME}] FAIL — cannot read ${COMMITTED}: ${err.message}\n`);
  process.stderr.write("Run: node scripts/gen-stripe-tiers.mjs\n");
  process.exit(1);
}

let regenerated;
try {
  regenerated = execFileSync("node", [GENERATOR, "--stdout"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
} catch (err) {
  process.stderr.write(`[${SCRIPT_NAME}] FAIL — generator errored: ${err.message}\n`);
  process.exit(2);
}

if (committed !== regenerated) {
  process.stderr.write(`\n[${SCRIPT_NAME}] FAIL — ${COMMITTED} is stale.\n`);
  process.stderr.write("Run: node scripts/gen-stripe-tiers.mjs\n");
  process.exit(1);
}

process.stdout.write(`[${SCRIPT_NAME}] OK — stripe_gen.ts is in sync with plans.yaml\n`);
