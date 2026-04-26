#!/usr/bin/env node
/**
 * Build guard: regenerate enterprise/docs/AUTH_RBAC_INVENTORY.md and
 * fail the build if the committed file differs.
 *
 * Spec: auth-resolution-hardening (R9.2).
 *
 * Usage
 * -----
 *   node scripts/check-auth-rbac-inventory-fresh.mjs
 *
 * Resolution
 * ----------
 * Run `npm run gen:auth-rbac-inventory` and commit the result in the
 * same PR as the chart change.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_NAME = 'check-auth-rbac-inventory-fresh.mjs';
const SPEC_NAME = 'auth-resolution-hardening';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const COMMITTED = resolve(REPO_ROOT, 'enterprise/docs/AUTH_RBAC_INVENTORY.md');
const GENERATOR = resolve(__dirname, 'gen-auth-rbac-inventory.mjs');

// Skip when committed file is not accessible (e.g., inside Docker build where
// REPO_ROOT resolves to filesystem root and enterprise/docs/ is outside the
// build context). The check is a dev-host gate.
// Spec: signup-zitadel-permissions-fix (Docker build fix for auth-resolution-hardening).
if (process.env.SKIP_DASHBOARD_RBAC_CHECK === '1') {
  console.log(`[${SCRIPT_NAME}] SKIPPED — SKIP_DASHBOARD_RBAC_CHECK=1`);
  process.exit(0);
}

let committed;
try {
  committed = readFileSync(COMMITTED, 'utf8');
} catch (err) {
  console.error(`[${SCRIPT_NAME}] FAIL — cannot read committed inventory at ${COMMITTED}: ${err.message}`);
  console.error('Run: npm run gen:auth-rbac-inventory');
  process.exit(1);
}

let regenerated;
try {
  regenerated = execFileSync('node', [GENERATOR, '--stdout'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  console.error(`[${SCRIPT_NAME}] FAIL — generator errored: ${err.message}`);
  process.exit(2);
}

if (committed !== regenerated) {
  console.error(`\n[${SCRIPT_NAME}] FAIL — ${COMMITTED} is stale. Spec: ${SPEC_NAME}`);
  console.error('Resolve by running: npm run gen:auth-rbac-inventory');
  console.error('Then commit the regenerated file alongside your chart change.');
  process.exit(1);
}
console.log(`[${SCRIPT_NAME}] OK — inventory doc is in sync with rendered chart`);
