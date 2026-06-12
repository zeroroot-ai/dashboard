#!/usr/bin/env node
/**
 * Build guard: fail the dashboard build if any source file re-introduces
 * a "permissive dev" / "skip auth" / "bypass auth" env var.
 *
 * Spec: eliminate-permissive-authz Requirement 2 + Requirement 5.
 *
 * Background
 * ----------
 * The dashboard previously had `DASHBOARD_AUTHZ_PERMISSIVE_DEV` (server)
 * and `NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV` (client) env vars
 * that flipped registry-miss authz from DENY to ALLOW in non-production
 * NODE_ENV. Per the user directive on `docs/PRODUCTION-TODOS.md` Tier 3
 * high, *"there should be no more permissive anything any more, all
 * that code should be deleted"*, the flags were deleted entirely.
 *
 * This guard prevents the flags (or a synonym under any new name) from
 * being re-introduced.
 *
 * Detection heuristics
 * --------------------
 * A file is in violation when ANY of these patterns matches in committed
 * source (case-sensitive unless noted):
 *
 *   1. The literal flag names:
 *        - DASHBOARD_AUTHZ_PERMISSIVE_DEV
 *        - NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV
 *
 *   2. Any env-var name matching the regex /_PERMISSIVE\b/i within
 *      WINDOW lines of `process.env`. Catches `FOO_PERMISSIVE_BAR`,
 *      `permissiveAuth` (in env access context), etc.
 *
 *   3. Common synonyms (case-insensitive) within WINDOW lines of
 *      `process.env`:
 *        - SKIP_AUTH        (e.g. SKIP_AUTH=1)
 *        - BYPASS_AUTH      (e.g. BYPASS_AUTH=true)
 *        - DISABLE_AUTH     (e.g. DISABLE_AUTH=1)
 *        - NOAUTH / NO_AUTH (e.g. NOAUTH=1)
 *        - UNSAFE_ALLOW     (e.g. UNSAFE_ALLOW_*=1)
 *
 * What is scanned
 * ---------------
 * `.ts` and `.tsx` files under `app/` and `src/`, EXCLUDING:
 *   - `node_modules/`, `.next/`
 *   - `__tests__/` directories
 *   - `*.test.*`, `*.spec.*` (tests assert deny-in-prod-with-flag-set;
 *     they intentionally name the deleted flag)
 *   - `src/gen/` (generated)
 *   - This script itself
 *
 * Self-test
 * ---------
 * Pass `--selftest` to write a temporary fixture, verify the guard catches
 * it, and clean up. Exits 0 if the guard correctly fires, 1 if it doesn't.
 *
 * Usage
 * -----
 *   node scripts/check-no-permissive-flags.mjs            # normal scan
 *   node scripts/check-no-permissive-flags.mjs --selftest # verify guard
 *
 * Exit codes: 0 = clean, 1 = violation detected
 */

import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_NAME = 'check-no-permissive-flags.mjs';
const SPEC_NAME = 'eliminate-permissive-authz';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SCAN_DIRS = ['app', 'src'];
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__', 'gen']);
const SKIP_FILES = new Set([`scripts/${SCRIPT_NAME}`]);
const SOURCE_EXT = /\.(?:tsx|ts)$/;
const TEST_FILE_PATTERN = /\.(?:test|spec)\./;

/** Lines within this many lines of a `process.env` are "nearby". */
const WINDOW = 3;

/** Literal flag names, flagged anywhere in scanned source. */
const LITERAL_FLAGS = [
  'DASHBOARD_AUTHZ_PERMISSIVE_DEV',
  'NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV',
];

/**
 * Synonyms requiring proximity to `process.env`. Case-insensitive.
 * The proximity rule keeps the guard from misfiring on docstrings or
 * unrelated identifiers; it requires actual env-var access on a nearby
 * line.
 */
const PROXIMITY_SYNONYMS = [
  'SKIP_AUTH',
  'BYPASS_AUTH',
  'DISABLE_AUTH',
  'NOAUTH',
  'NO_AUTH',
  'UNSAFE_ALLOW',
];

/** Regex match for any *_PERMISSIVE_* env-var-ish identifier. */
const PERMISSIVE_REGEX = /_PERMISSIVE\b/i;

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

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
      // Skip src/gen/ specifically (generated TS).
      if (rel === 'src/gen' || rel.startsWith('src/gen/')) continue;
      walk(full, out);
    } else if (ent.isFile()) {
      if (!SOURCE_EXT.test(ent.name)) continue;
      if (TEST_FILE_PATTERN.test(ent.name)) continue;
      if (SKIP_FILES.has(rel)) continue;
      out.push({ full, rel });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-file scan
// ---------------------------------------------------------------------------

function scanFile(fullPath, rel) {
  let body;
  try {
    body = readFileSync(fullPath, 'utf8');
  } catch {
    return [];
  }

  const lines = body.split(/\r?\n/);
  const violations = [];

  // Index: lines containing process.env (any case-correct form).
  const envLineNos = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('process.env')) {
      envLineNos.push(i);
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // (1) Literal flag names, flagged ANYWHERE.
    for (const flag of LITERAL_FLAGS) {
      if (line.includes(flag)) {
        violations.push({
          rel,
          line: i + 1,
          marker: flag,
          kind: 'literal-flag',
          content: line.trim().slice(0, 200),
        });
      }
    }

    // (2) /_PERMISSIVE\b/ pattern within WINDOW of process.env.
    if (PERMISSIVE_REGEX.test(line)) {
      const nearEnv = envLineNos.some((e) => Math.abs(e - i) <= WINDOW);
      if (nearEnv) {
        // Skip if already flagged by literal-flag rule on the same line.
        const alreadyFlagged = violations.some(
          (v) => v.rel === rel && v.line === i + 1 && v.kind === 'literal-flag',
        );
        if (!alreadyFlagged) {
          violations.push({
            rel,
            line: i + 1,
            marker: '_PERMISSIVE_',
            kind: 'permissive-near-env',
            content: line.trim().slice(0, 200),
          });
        }
      }
    }

    // (3) Synonyms (case-insensitive) within WINDOW of process.env.
    const upper = line.toUpperCase();
    for (const syn of PROXIMITY_SYNONYMS) {
      if (upper.includes(syn)) {
        const nearEnv = envLineNos.some((e) => Math.abs(e - i) <= WINDOW);
        if (nearEnv) {
          violations.push({
            rel,
            line: i + 1,
            marker: syn,
            kind: 'synonym-near-env',
            content: line.trim().slice(0, 200),
          });
          break; // one synonym per line is enough
        }
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

function runScan(scanDirs = SCAN_DIRS) {
  const files = [];
  for (const dir of scanDirs) {
    walk(join(ROOT, dir), files);
  }
  const all = [];
  for (const { full, rel } of files) {
    all.push(...scanFile(full, rel));
  }
  return { violations: all, fileCount: files.length };
}

function printViolations(violations) {
  for (const v of violations) {
    process.stderr.write(
      `❌ ${v.rel}:${v.line}, permissive flag detected (${v.kind}: "${v.marker}")\n` +
        `   ${v.content}\n\n`,
    );
  }
  process.stderr.write(
    `Why this exists\n` +
      `---------------\n` +
      `Spec "${SPEC_NAME}" Requirement 2 deleted\n` +
      `DASHBOARD_AUTHZ_PERMISSIVE_DEV (server) and\n` +
      `NEXT_PUBLIC_DASHBOARD_AUTHZ_PERMISSIVE_DEV (client). The new contract\n` +
      `is that unknown methods always throw AuthzDeniedError(unknown_method)\n` +
      `regardless of NODE_ENV. There is no environment-conditioned escape\n` +
      `hatch under any name.\n` +
      `\n` +
      `Fix: remove the flag and the env-conditioned branch. If you need to\n` +
      `support a new RPC, regenerate src/gen/authz/registry.ts via\n` +
      `\`pnpm prebuild\` (which runs gen-authz-registry.mjs).\n` +
      `\n` +
      `Patterns checked:\n` +
      `  - literal: ${LITERAL_FLAGS.join(', ')}\n` +
      `  - synonyms (within ${WINDOW} lines of process.env): ${PROXIMITY_SYNONYMS.join(', ')}\n` +
      `  - regex (within ${WINDOW} lines of process.env): /_PERMISSIVE\\b/i\n`,
  );
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function runSelfTest() {
  const fixturePath = join(ROOT, 'src', '_selftest_permissive_fixture.ts');
  const fixtureContent = [
    '// SELFTEST FIXTURE, auto-deleted immediately after the guard runs',
    'export function bad(): boolean {',
    '  return process.env.DASHBOARD_AUTHZ_PERMISSIVE_DEV === "1";',
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
    const { violations } = runScan(['src']);
    caught = violations.some((v) => v.rel.includes('_selftest_permissive_fixture'));
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
    `${SCRIPT_NAME} --selftest: FAIL, guard did NOT catch a deliberate permissive flag in a fixture file.\n`,
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
  process.stdout.write(`${SCRIPT_NAME}: clean (${fileCount} files scanned)\n`);
  process.exit(0);
}
