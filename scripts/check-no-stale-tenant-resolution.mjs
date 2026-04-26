#!/usr/bin/env node
/**
 * Build guard: fail the build if any dashboard source file references the
 * removed tenant-resolution machinery.
 *
 * Spec: tenant-membership-not-in-jwt — task 18
 * Requirement: R9 criterion 1
 *
 * Background
 * ----------
 * The spec removed the `tenant` field from the Auth.js session and deleted
 * three resolution tiers (`gibson:tenant` claim, `urn:zitadel:iam:user:resourceowner:id`
 * claim, K8s `tenants-by-owner` lookup). Active tenant now lives in the
 * `gibson_active_tenant` cookie managed by `src/lib/auth/active-tenant.ts`,
 * and memberships come from the daemon's ListMyMemberships RPC via
 * `src/lib/auth/membership.ts`.
 *
 * This guard prevents the deleted patterns from creeping back in.
 *
 * Detection
 * ---------
 * Fails the build on any non-comment occurrence of:
 *   - `session.user.tenant`  (the removed type field — different from .tenantId
 *                             which the GibsonSession wrapper still exposes)
 *   - `gibson:tenant`        (deleted Zitadel claim tier 1)
 *   - `urn:zitadel:iam:user:resourceowner:id`  (deleted Zitadel claim tier 2)
 *   - `listTenantsForOwner`  (deleted K8s helper)
 *   - `tenants-by-owner`     (deleted K8s module path)
 *
 * Comment-only mentions are allowed so post-deletion explanatory comments
 * don't trip the guard.
 *
 * What is scanned
 * ---------------
 * `.ts` and `.tsx` files under `app/`, `src/`, `auth.ts`, `middleware.ts`,
 * EXCLUDING node_modules, .next, __tests__, *.test.*, *.spec.*, generated
 * proto bindings under src/gen, and this script itself.
 *
 * Self-test
 * ---------
 * Pass `--selftest` to write a temporary fixture, verify the guard catches
 * it, and clean up.
 *
 * Usage
 * -----
 *   node scripts/check-no-stale-tenant-resolution.mjs
 *   node scripts/check-no-stale-tenant-resolution.mjs --selftest
 *
 * Exit codes: 0 = clean, 1 = violation detected
 */

import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_NAME = 'check-no-stale-tenant-resolution.mjs';
const SPEC_NAME = 'tenant-membership-not-in-jwt';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SCAN_DIRS = ['app', 'src'];
const TOPLEVEL_FILES = ['auth.ts', 'middleware.ts'];

const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__', 'gen']);
const SOURCE_EXT = /\.(?:ts|tsx)$/;
const TEST_FILE_PATTERN = /\.(?:test|spec)\./;
const SKIP_FILES = new Set([`scripts/${SCRIPT_NAME}`]);

/**
 * Banned patterns. Each entry is a literal needle (string) or regex.
 * `session.user.tenant` is matched as a regex with negative lookahead so
 * the GibsonSession wrapper's `tenantId` / `tenants` / `tenantSwitcher`
 * fields don't trip the guard.
 */
const BANNED = [
  [/\bsession\.user\.tenant(?![A-Za-z])/, 'removed Auth.js session field — use getActiveTenant() / getMyMemberships() instead'],
  ['gibson:tenant', 'deleted Zitadel claim (tier 1) — tenant comes from the gibson_active_tenant cookie now'],
  ['urn:zitadel:iam:user:resourceowner:id', 'deleted Zitadel claim (tier 2)'],
  ['listTenantsForOwner', 'deleted K8s helper from src/lib/k8s/tenants-by-owner.ts'],
  ['tenants-by-owner', 'deleted module — see spec tenant-membership-not-in-jwt'],
];

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
  }
}

function shouldScan(absPath) {
  const rel = relative(ROOT, absPath);
  if (SKIP_FILES.has(rel)) return false;
  if (TEST_FILE_PATTERN.test(rel)) return false;
  if (!SOURCE_EXT.test(rel)) return false;
  return true;
}

function scanFile(absPath) {
  const violations = [];
  let contents;
  try {
    contents = readFileSync(absPath, 'utf8');
  } catch {
    return violations;
  }
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const [pattern, reason] of BANNED) {
      let idx = -1;
      let display = '';
      if (pattern instanceof RegExp) {
        const m = pattern.exec(line);
        if (!m) continue;
        idx = m.index;
        display = m[0];
      } else {
        idx = line.indexOf(pattern);
        if (idx === -1) continue;
        display = pattern;
      }
      // Allow occurrences inside line-trailing comments.
      const commentStart = line.indexOf('//');
      if (commentStart !== -1 && commentStart < idx) continue;
      violations.push({ line: i + 1, needle: display, reason, snippet: line.trim() });
    }
  }
  return violations;
}

function scan() {
  const targets = [];
  for (const file of TOPLEVEL_FILES) {
    targets.push(resolve(ROOT, file));
  }
  for (const dir of SCAN_DIRS) {
    for (const path of walk(resolve(ROOT, dir))) {
      if (shouldScan(path)) targets.push(path);
    }
  }
  let total = 0;
  for (const path of targets) {
    const v = scanFile(path);
    if (v.length === 0) continue;
    total += v.length;
    console.error(`\n${relative(ROOT, path)}`);
    for (const { line, needle, reason, snippet } of v) {
      console.error(`  L${line}: ${needle} — ${reason}`);
      console.error(`    ${snippet}`);
    }
  }
  return total;
}

function selftest() {
  const fixture = resolve(ROOT, 'src/__guard_selftest_tenant_resolution.ts');
  writeFileSync(fixture, "const t = session.user.tenant;\n", 'utf8');
  try {
    const v = scanFile(fixture);
    if (v.length === 0) {
      console.error(`[${SCRIPT_NAME}] SELFTEST FAILED: guard did not fire on planted violation`);
      process.exit(1);
    }
    console.log(`[${SCRIPT_NAME}] selftest OK — guard caught the planted violation`);
  } finally {
    try { unlinkSync(fixture); } catch { /* ignore */ }
  }
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  selftest();
  process.exit(0);
}

const violations = scan();
if (violations > 0) {
  console.error(`\n[${SCRIPT_NAME}] FAIL — ${violations} violation(s). Spec: ${SPEC_NAME}`);
  console.error('Use the new auth modules: getActiveTenant() and getMyMemberships().');
  process.exit(1);
}
console.log(`[${SCRIPT_NAME}] OK — no banned tenant-resolution patterns found`);
