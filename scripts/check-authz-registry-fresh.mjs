#!/usr/bin/env node
/**
 * Build guard: verify that src/gen/authz/registry.ts is in sync with the
 * current SDK AND daemon-local proto annotations.
 *
 * Drives gen-authz-registry.mjs --stdout (the dual-tree workspace-synthesis
 * pipeline from task 12) to produce the expected registry, then diffs
 * byte-for-byte against the committed file. Exits non-zero on any discrepancy
 * so CI fails fast when protos in either tree change without a regen commit.
 *
 * Non-zero exit codes from the generator (e.g. buf build failure, empty FDS,
 * cross-tree collision) are propagated as exit code 2 — this script does NOT
 * swallow them.
 *
 * Spec: dashboard-authz-ui-gating Requirement 1.4, 1.5, 9.5.
 * Sister-spec: cross-repo-cohesion-fixes Requirement 2.4, 2.5.
 *
 * Usage
 * -----
 *   node scripts/check-authz-registry-fresh.mjs
 *
 * Resolution
 * ----------
 *   Run `pnpm gen:authz` and commit src/gen/authz/registry.ts alongside the
 *   proto change.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_NAME = 'check-authz-registry-fresh.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, '..');
const COMMITTED = resolve(DASHBOARD_ROOT, 'src/gen/authz/registry.ts');
const GENERATOR = resolve(__dirname, 'gen-authz-registry.mjs');

// Allow Docker / CI environments without full proto checkout to opt out.
if (process.env.SKIP_AUTHZ_REGISTRY_CHECK === '1') {
  process.stdout.write(`[${SCRIPT_NAME}] SKIPPED — SKIP_AUTHZ_REGISTRY_CHECK=1\n`);
  process.exit(0);
}

let committed;
try {
  committed = readFileSync(COMMITTED, 'utf8');
} catch (err) {
  process.stderr.write(
    `[${SCRIPT_NAME}] FAIL — cannot read committed registry at ${COMMITTED}: ${err.message}\n`,
  );
  process.stderr.write('Run: pnpm gen:authz\n');
  process.exit(1);
}

let regenerated;
try {
  regenerated = execFileSync('node', [GENERATOR, '--stdout'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  process.stderr.write(
    `[${SCRIPT_NAME}] FAIL — generator errored: ${err.message}\n`,
  );
  process.exit(2);
}

if (committed !== regenerated) {
  process.stderr.write(`\n[${SCRIPT_NAME}] FAIL — ${COMMITTED} is stale.\n`);
  process.stderr.write(
    'The authz registry does not match the current SDK proto annotations.\n',
  );
  process.stderr.write('Resolve by running: pnpm gen:authz\n');
  process.stderr.write('Then commit src/gen/authz/registry.ts alongside the proto change.\n');
  process.exit(1);
}

process.stdout.write(`[${SCRIPT_NAME}] OK — authz registry is in sync with SDK + daemon-local protos\n`);
