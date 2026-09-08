#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Build guard: regenerate docs/AUTH_RBAC_INVENTORY.md and fail the build if
 * the committed file differs.
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
const DASHBOARD_ROOT = resolve(__dirname, '..');
// The inventory is committed in this repository, so it is always present and
// the gate is never vacuous.
const COMMITTED = resolve(DASHBOARD_ROOT, 'docs/AUTH_RBAC_INVENTORY.md');
const GENERATOR = resolve(__dirname, 'gen-auth-rbac-inventory.mjs');

// Skip inside the Docker build, which carries neither the committed docs/ tree
// nor a charts checkout. The check is a dev-host gate.
// Spec: signup-zitadel-permissions-fix (Docker build fix for auth-resolution-hardening).
if (process.env.SKIP_DASHBOARD_RBAC_CHECK === '1') {
  console.log(`[${SCRIPT_NAME}] SKIPPED, SKIP_DASHBOARD_RBAC_CHECK=1`);
  process.exit(0);
}

const HEADER = '# Auth RBAC Inventory, Gibson Dashboard';

let committed;
try {
  committed = readFileSync(COMMITTED, 'utf8');
} catch (err) {
  console.error(`[${SCRIPT_NAME}] FAIL, cannot read committed inventory at ${COMMITTED}: ${err.message}`);
  console.error('Run: npm run gen:auth-rbac-inventory');
  process.exit(1);
}

// STRUCTURAL pass: with no charts checkout nearby the generator has nothing to
// read, so a byte-diff is impossible. The gate still refuses a deleted, empty
// or header-stripped artifact, so it is never vacuous. The generator answers
// "can you read your source?" itself; the gate is never told to look away.
let probe;
try {
  probe = JSON.parse(
    execFileSync('node', [GENERATOR, '--probe'], { encoding: 'utf8' }),
  );
} catch (err) {
  console.error(`[${SCRIPT_NAME}] FAIL, generator --probe errored: ${err.message}`);
  process.exit(2);
}
if (!probe.available) {
  if (committed.trim() === '' || !committed.startsWith(HEADER)) {
    console.error(
      `[${SCRIPT_NAME}] FAIL, ${COMMITTED} is empty or has lost its generated header.`,
    );
    console.error('Run: npm run gen:auth-rbac-inventory');
    process.exit(1);
  }
  console.log(
    `[${SCRIPT_NAME}] OK (structural), no charts checkout to render against; ` +
      'the committed inventory exists, is non-empty and carries its header.',
  );
  process.exit(0);
}

let regenerated;
try {
  regenerated = execFileSync('node', [GENERATOR, '--stdout'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  console.error(`[${SCRIPT_NAME}] FAIL, generator errored: ${err.message}`);
  process.exit(2);
}

if (committed !== regenerated) {
  console.error(`\n[${SCRIPT_NAME}] FAIL, ${COMMITTED} is stale. Spec: ${SPEC_NAME}`);
  console.error('Resolve by running: npm run gen:auth-rbac-inventory');
  console.error('Then commit the regenerated file alongside your chart change.');
  process.exit(1);
}
console.log(`[${SCRIPT_NAME}] OK, inventory doc is in sync with rendered chart`);
