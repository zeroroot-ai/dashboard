#!/usr/bin/env node
/**
 * Meta-guard: run every build guard's `--selftest` and fail if any guard has
 * lost its teeth.
 *
 * ## Why this exists
 *
 * This repo has shipped inert guards twice. A guard that cannot fail is worse
 * than no guard: it produces a green check that everyone reads as "verified".
 * Reviewing a guard's source does not catch this, both inert guards looked
 * plausible; the only reliable test is to introduce the exact defect the guard
 * exists to catch and confirm it fails.
 *
 * Each listed guard implements `--selftest`, which builds throwaway fixtures,
 * asserts the guard REJECTS every defect it claims to catch, and asserts it
 * ACCEPTS a compliant fixture (so a guard that always fails is caught too).
 * This script runs them all as one CI step.
 *
 * ## Adding a guard
 *
 * Implement `--selftest` in it, then add it below. New guards should be added
 * here as a matter of course; a guard with no self-test is unverified.
 *
 * Usage: node scripts/check-guard-selftests.mjs
 * Exit codes: 0 all guards proved they bite, 1 at least one did not.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const SCRIPT_NAME = "check-guard-selftests";
const SCRIPTS_DIR = fileURLToPath(new URL(".", import.meta.url));

const GUARDS = [
  "check-csp.mjs",
  "check-no-secrets-in-client.mjs",
  "check-server-action-authz.mjs",
  "check-no-store-clients.mjs",
  "check-no-nodeenv-conditioned-auth.mjs",
  "check-lockfile-sync.mjs",
  "check-api-route-csrf.mjs",
];

let failed = 0;

for (const guard of GUARDS) {
  process.stdout.write(`\n[${SCRIPT_NAME}] ${guard} --selftest\n`);
  const result = spawnSync(process.execPath, [join(SCRIPTS_DIR, guard), "--selftest"], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    failed += 1;
    process.stderr.write(
      `[${SCRIPT_NAME}] ${guard} FAILED its self-test (exit ${result.status}).\n`,
    );
  }
}

if (failed > 0) {
  process.stderr.write(
    `\n[${SCRIPT_NAME}] FAIL, ${failed} of ${GUARDS.length} guard(s) could not prove ` +
      `they detect the defect they exist to catch.\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `\n[${SCRIPT_NAME}] OK, all ${GUARDS.length} guards proved they reject their ` +
    `target defect and accept a compliant fixture.\n`,
);
