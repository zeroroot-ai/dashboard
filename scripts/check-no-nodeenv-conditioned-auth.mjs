#!/usr/bin/env node
/**
 * Build guard: fail the dashboard build if any source file under the
 * authz / identity / daemon-call paths introduces a new
 * `process.env.NODE_ENV` reference.
 *
 * Spec: eliminate-permissive-authz Requirement 5.
 *
 * Background
 * ----------
 * `NODE_ENV` is famously fragile in production deployments. A
 * misconfigured prod image with `NODE_ENV=development` would silently
 * unlock any branch gated on `process.env.NODE_ENV !== 'production'`.
 * The previous `DASHBOARD_AUTHZ_PERMISSIVE_DEV` flag was exactly this
 * shape; deletion is locked by `check-no-permissive-flags.mjs`. This
 * guard prevents the same anti-pattern from being introduced under a
 * different shape (e.g. a fresh `NODE_ENV !== 'production'` branch in
 * an authz module).
 *
 * Detection heuristic
 * -------------------
 * A file is in violation when ANY line in a restricted path contains
 * `process.env.NODE_ENV` and is NOT listed in `.permitted-nodeenv.json`.
 *
 * Restricted paths
 * ----------------
 * - `src/lib/auth/**`
 * - `src/middleware.ts`
 * - `*.actions.ts` (server actions, anywhere under src/ or app/)
 * - `src/app/api/auth/**`
 *
 * Excluded everywhere
 * -------------------
 * - `node_modules/`, `.next/`, `__tests__/`, `*.test.*`, `*.spec.*`,
 *   `src/gen/`.
 * - This script itself.
 *
 * Allow-list
 * ----------
 * `.permitted-nodeenv.json` at the dashboard root lists pre-existing
 * audited legitimate hits as `[ { file: "src/lib/auth/x.ts", line: 42,
 * kind: "...", rationale: "..." } ]`. Each entry needs reviewer
 * scrutiny when introduced: only non-authz conditioning (cookie-secure,
 * dev-only logging) is acceptable. Authz/identity/daemon-call
 * conditioning on NODE_ENV is forbidden under any new shape.
 *
 * Self-test
 * ---------
 * Pass `--selftest` to write a temporary fixture under `src/lib/auth/`
 * with a deliberate NODE_ENV check, verify the guard catches it, and
 * clean up.
 *
 * Exit codes: 0 = clean, 1 = violation detected
 */

import { readdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_NAME = 'check-no-nodeenv-conditioned-auth.mjs';
const SPEC_NAME = 'eliminate-permissive-authz';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const ALLOWLIST_FILE = '.permitted-nodeenv.json';

const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__']);
const SKIP_FILES = new Set([`scripts/${SCRIPT_NAME}`]);
const SOURCE_EXT = /\.(?:tsx|ts)$/;
const TEST_FILE_PATTERN = /\.(?:test|spec)\./;

const NODEENV_NEEDLE = 'process.env.NODE_ENV';

/** Globs (path-prefix matchers), restricted to authz/identity/daemon-call code. */
const RESTRICTED_PATH_PREFIXES = [
  'src/lib/auth/',
  'src/app/api/auth/',
];

/** Single-file restricted paths. */
const RESTRICTED_FILES = [
  'src/middleware.ts',
];

/** Filename pattern for server-action files. */
const ACTIONS_FILE_PATTERN = /\.actions\.tsx?$/;

// ---------------------------------------------------------------------------
// Allow-list loader
// ---------------------------------------------------------------------------

function loadAllowList() {
  const path = join(ROOT, ALLOWLIST_FILE);
  if (!existsSync(path)) {
    return new Set(); // empty allow-list is fine (forces clean state)
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (!raw || !Array.isArray(raw.permitted)) return new Set();
    const out = new Set();
    for (const ent of raw.permitted) {
      if (typeof ent.file === 'string' && Number.isInteger(ent.line)) {
        out.add(`${ent.file}:${ent.line}`);
      }
    }
    return out;
  } catch (err) {
    process.stderr.write(`${SCRIPT_NAME}: malformed ${ALLOWLIST_FILE}: ${err.message}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

function isInRestrictedPath(rel) {
  if (RESTRICTED_FILES.includes(rel)) return true;
  if (ACTIONS_FILE_PATTERN.test(rel)) return true;
  for (const prefix of RESTRICTED_PATH_PREFIXES) {
    if (rel.startsWith(prefix)) return true;
  }
  return false;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    const rel = relative(ROOT, full);
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue;
      if (rel === 'src/gen' || rel.startsWith('src/gen/')) continue;
      walk(full, out);
    } else if (ent.isFile()) {
      if (!SOURCE_EXT.test(ent.name)) continue;
      if (TEST_FILE_PATTERN.test(ent.name)) continue;
      if (SKIP_FILES.has(rel)) continue;
      if (!isInRestrictedPath(rel)) continue;
      out.push({ full, rel });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-file scan
// ---------------------------------------------------------------------------

function scanFile(fullPath, rel, allowSet) {
  let body;
  try {
    body = readFileSync(fullPath, 'utf8');
  } catch {
    return [];
  }
  const lines = body.split(/\r?\n/);
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(NODEENV_NEEDLE)) {
      const key = `${rel}:${i + 1}`;
      if (!allowSet.has(key)) {
        violations.push({ rel, line: i + 1, content: lines[i].trim().slice(0, 200) });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

function runScan() {
  const allowSet = loadAllowList();
  const files = [];
  for (const top of ['app', 'src']) {
    walk(join(ROOT, top), files);
  }
  const all = [];
  for (const { full, rel } of files) {
    all.push(...scanFile(full, rel, allowSet));
  }
  return { violations: all, fileCount: files.length };
}

function printViolations(violations) {
  for (const v of violations) {
    process.stderr.write(
      `❌ ${v.rel}:${v.line}, process.env.NODE_ENV reference in restricted authz/identity/daemon-call path\n` +
        `   ${v.content}\n\n`,
    );
  }
  process.stderr.write(
    `Why this exists\n` +
      `---------------\n` +
      `Spec "${SPEC_NAME}" Requirement 5: NODE_ENV-conditioned authz/identity/\n` +
      `daemon-call branches are forbidden because NODE_ENV is fragile in\n` +
      `prod deployments, a misconfigured image with NODE_ENV=development\n` +
      `silently unlocks every \`!== 'production'\` branch.\n` +
      `\n` +
      `If your hit is genuinely non-authz (e.g. cookie-secure flag,\n` +
      `dev-only logging), add it to .permitted-nodeenv.json with a\n` +
      `rationale string and have a security reviewer sign off. Do NOT\n` +
      `add authz/identity/daemon-call hits to the allow-list, find a\n` +
      `same-in-dev-and-prod approach.\n`,
  );
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function runSelfTest() {
  const fixturePath = join(ROOT, 'src', 'lib', 'auth', '__nodeenv_selftest.ts');
  const fixtureContent = [
    '// SELFTEST FIXTURE, auto-deleted immediately after the guard runs',
    'export function bad(): boolean {',
    "  return process.env.NODE_ENV !== 'production';",
    '}',
  ].join('\n');

  try {
    writeFileSync(fixturePath, fixtureContent, 'utf8');
  } catch (err) {
    process.stderr.write(`selftest: could not write fixture: ${err.message}\n`);
    process.exit(1);
  }

  let caught = false;
  try {
    const { violations } = runScan();
    caught = violations.some((v) => v.rel.endsWith('__nodeenv_selftest.ts'));
  } finally {
    try {
      unlinkSync(fixturePath);
    } catch {
      // best-effort
    }
  }

  if (caught) {
    process.stdout.write(
      `${SCRIPT_NAME} --selftest: PASS, guard correctly caught the synthetic violation.\n`,
    );
    process.exit(0);
  }
  process.stderr.write(
    `${SCRIPT_NAME} --selftest: FAIL, guard did NOT catch a deliberate NODE_ENV reference in src/lib/auth/.\n`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('--selftest')) {
  runSelfTest();
} else {
  const { violations, fileCount } = runScan();
  if (violations.length > 0) {
    process.stderr.write(
      `\n${SCRIPT_NAME}: ${violations.length} violation${violations.length === 1 ? '' : 's'} found.\n\n`,
    );
    printViolations(violations);
    process.exit(1);
  }
  process.stdout.write(`${SCRIPT_NAME}: clean (${fileCount} restricted files scanned)\n`);
  process.exit(0);
}
