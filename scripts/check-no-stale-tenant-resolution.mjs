#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Build guard: fail the build if any dashboard source file references the
 * removed tenant-resolution machinery.
 *
 * Spec: tenant-membership-not-in-jwt, task 18
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
 *   - `session.user.tenant`  (the removed type field, different from .tenantId
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
 * Files allowed to set the `x-gibson-tenant` header for a person (ADR-0093
 * decision 4 keeps ONE exception: `serviceClient` in the single transport
 * module still names a tenant explicitly for service-acting calls, case 2 of
 * the tenant-derivation rules). Keyed by path, never by line number, so a
 * reflow of the file cannot silently widen or narrow the allowance.
 */
const X_GIBSON_TENANT_HEADER_ALLOWED_FILES = new Set([
  'src/lib/gibson-client/transport.ts',
]);

/**
 * Banned patterns. Each entry is a literal needle (string) or regex, with an
 * optional third element: an array of paths (relative to ROOT) where the
 * needle is allowed. `session.user.tenant` is matched as a regex with
 * negative lookahead so the GibsonSession wrapper's `tenantId` / `tenants`
 * fields don't trip the guard.
 */
const BANNED = [
  [/\bsession\.user\.tenant(?![A-Za-z])/, 'removed Auth.js session field, use requireActiveTenant() / getMyMemberships() instead'],
  ['gibson:tenant', 'deleted Zitadel claim (tier 1); the tenant comes from the token\'s verified Zitadel org now (ADR-0093 decision 4)'],
  ['urn:zitadel:iam:user:resourceowner:id', 'deleted Zitadel claim (tier 2)'],
  ['listTenantsForOwner', 'deleted K8s helper from src/lib/k8s/tenants-by-owner.ts'],
  ['tenants-by-owner', 'deleted module, see spec tenant-membership-not-in-jwt'],
  // Spec auth-resolution-hardening (R5.3), legacy reason codes / comment terms.
  ['tier 3', 'legacy fallback-chain language; removed under spec auth-resolution-hardening, describe the new path directly instead'],
  ['fallback chain', 'legacy fallback-chain language; removed under spec auth-resolution-hardening'],
  // ADR-0093 decision 4: the picker, the cookie, and the client-supplied
  // tenant header for a person's own requests are all deleted outright.
  ['gibson_active_tenant', 'deleted cookie (ADR-0093 decision 4); the tenant is resolved server-side onto the session, never a cookie'],
  ['select-tenant', 'deleted picker route (ADR-0093 decision 4); a person has exactly one tenant, resolved server-side, never chosen'],
  [/\bsetActiveTenant\s*\(/, 'deleted cookie writer (ADR-0093 decision 4); there is no client-side tenant to set'],
  [/\breadRawActiveTenant\s*\(/, 'deleted cookie reader (ADR-0093 decision 4); use requireActiveTenant() or session.tenantId'],
  ['x-gibson-tenant', 'a person\'s tenant comes from their token, never a header (ADR-0093 decision 4); only serviceClient in src/lib/gibson-client/transport.ts may set this header, for service-acting calls', X_GIBSON_TENANT_HEADER_ALLOWED_FILES],
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
  const relPath = relative(ROOT, absPath).split('\\').join('/');
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const [pattern, reason, allowedFiles] of BANNED) {
      if (allowedFiles && allowedFiles.has(relPath)) continue;
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
      console.error(`  L${line}: ${needle}, ${reason}`);
      console.error(`    ${snippet}`);
    }
  }
  return total;
}

/**
 * One fixture body per needle this guard bans. Each must plant its needle
 * on a non-comment, non-trailing-comment line so the scan actually reaches
 * the pattern check.
 */
const SELFTEST_FIXTURES = [
  { name: 'session.user.tenant', body: 'const t = session.user.tenant;\n' },
  { name: 'gibson:tenant', body: 'const claim = "gibson:tenant";\n' },
  { name: 'gibson_active_tenant', body: 'const cookieName = "gibson_active_tenant";\n' },
  { name: 'select-tenant', body: 'redirect("/select-tenant");\n' },
  { name: 'setActiveTenant(', body: 'await setActiveTenant(tenantId);\n' },
  { name: 'readRawActiveTenant(', body: 'const raw = await readRawActiveTenant();\n' },
  { name: 'x-gibson-tenant (outside the transport module)', body: "req.header.set('x-gibson-tenant', tenant);\n" },
];

function selftest() {
  let failed = false;
  for (const { name, body } of SELFTEST_FIXTURES) {
    const fixture = resolve(ROOT, 'src/__guard_selftest_tenant_resolution.ts');
    writeFileSync(fixture, body, 'utf8');
    try {
      const v = scanFile(fixture);
      if (v.length === 0) {
        console.error(`[${SCRIPT_NAME}] SELFTEST FAILED: guard did not fire on planted violation (${name})`);
        failed = true;
      }
    } finally {
      try { unlinkSync(fixture); } catch { /* ignore */ }
    }
  }
  // The allowed file must NOT trip on the one needle it is exempt from.
  const allowedFixture = resolve(ROOT, X_GIBSON_TENANT_HEADER_ALLOWED_FILES.values().next().value);
  const allowedContents = readFileSync(allowedFixture, 'utf8');
  if (!allowedContents.includes('x-gibson-tenant')) {
    console.error(
      `[${SCRIPT_NAME}] SELFTEST FAILED: the allowed file no longer sets x-gibson-tenant at all; ` +
        'the allowance and the selftest have drifted apart',
    );
    failed = true;
  }
  const allowedViolations = scanFile(allowedFixture).filter((v) => v.needle === 'x-gibson-tenant');
  if (allowedViolations.length > 0) {
    console.error(
      `[${SCRIPT_NAME}] SELFTEST FAILED: the allowed file (${relative(ROOT, allowedFixture)}) tripped the x-gibson-tenant needle`,
    );
    failed = true;
  }
  if (failed) {
    process.exit(1);
  }
  console.log(`[${SCRIPT_NAME}] selftest OK, guard caught every planted violation and respected the x-gibson-tenant allowance`);
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  selftest();
  process.exit(0);
}

const violations = scan();
if (violations > 0) {
  console.error(`\n[${SCRIPT_NAME}] FAIL, ${violations} violation(s). Spec: ${SPEC_NAME}`);
  console.error('Use the new auth modules: getActiveTenant() and getMyMemberships().');
  process.exit(1);
}
console.log(`[${SCRIPT_NAME}] OK, no banned tenant-resolution patterns found`);
