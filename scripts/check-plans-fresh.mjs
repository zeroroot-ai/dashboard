#!/usr/bin/env node
/**
 * Build guard: verify that src/generated/plans.ts is in sync with the current
 * deploy/helm/gibson-operators/files/plans.yaml (E4 fold, gibson#781 / ADR-0056).
 *
 * Drives gen-plans.mjs --stdout to produce the expected file, then diffs
 * byte-for-byte against the committed file. Exits non-zero on discrepancy
 * so CI fails fast when plans.yaml changes without a regen commit.
 *
 * Spec: plans-and-quotas-simplification (R3.3 drift gate).
 *
 * Usage:
 *   node scripts/check-plans-fresh.mjs
 *
 * Resolution:
 *   Run `pnpm gen:plans` (or just `pnpm prebuild`) and commit
 *   src/generated/plans.ts alongside the plans.yaml change.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_NAME = "check-plans-fresh.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, "..");
const COMMITTED = resolve(DASHBOARD_ROOT, "src/generated/plans.ts");
const GENERATOR = resolve(__dirname, "gen-plans.mjs");

if (process.env.SKIP_PLANS_FRESH_CHECK === "1") {
  process.stdout.write(`[${SCRIPT_NAME}] SKIPPED, SKIP_PLANS_FRESH_CHECK=1\n`);
  process.exit(0);
}

let committed;
try {
  committed = readFileSync(COMMITTED, "utf8");
} catch (err) {
  process.stderr.write(
    `[${SCRIPT_NAME}] FAIL, cannot read committed plans.ts at ${COMMITTED}: ${err.message}\n`,
  );
  process.stderr.write("Run: pnpm gen:plans\n");
  process.exit(1);
}

let regenerated;
try {
  regenerated = execFileSync("node", [GENERATOR, "--stdout"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
} catch (err) {
  process.stderr.write(
    `[${SCRIPT_NAME}] FAIL, generator errored: ${err.message}\n`,
  );
  process.exit(2);
}

if (committed !== regenerated) {
  process.stderr.write(`\n[${SCRIPT_NAME}] FAIL, ${COMMITTED} is stale.\n`);
  process.stderr.write(
    "src/generated/plans.ts does not match the current plans.yaml.\n",
  );
  process.stderr.write("Resolve by running: pnpm gen:plans\n");
  process.stderr.write(
    "Then commit src/generated/plans.ts alongside the plans.yaml change.\n",
  );
  process.exit(1);
}

process.stdout.write(
  `[${SCRIPT_NAME}] OK, plans.ts is in sync with plans.yaml\n`,
);
