#!/usr/bin/env node
/**
 * Build guard: fail the build if any dashboard source file references the
 * IAM_ADMIN_PAT credential.
 *
 * Spec: dashboard-native-signup, task 23
 * Requirement: R5 criterion 6 (NFR-security)
 *
 * Background
 * ----------
 * The `iam-admin-pat` / `IAM_ADMIN_PAT` credential grants IAM_OWNER-level
 * access to the Zitadel instance. Signup flows use a narrowly-scoped
 * `ZITADEL_SIGNUP_BOT_PAT` (IAM_USER_MANAGER only) instead. The admin PAT
 * must never be wired into the dashboard runtime; keeping it out of the
 * source tree prevents an accidental re-introduction.
 *
 * What is scanned
 * ---------------
 * All `.ts`, `.tsx`, `.js`, and `.mjs` files under `app/` and `src/`.
 *
 * What is skipped
 * ---------------
 * - `node_modules/`, `.next/`, build artefacts
 * - `__tests__/` directories, `*.test.*`, `*.spec.*`, regression test
 *   files are explicitly allowed to mention the pattern so they can assert
 *   the invariant themselves
 * - This script file (to avoid self-match on the pattern list)
 *
 * Matched substrings (case-insensitive where noted)
 * --------------------------------------------------
 *   iam-admin-pat   (case-insensitive)
 *   iam_admin_pat   (case-insensitive)
 *   IAM_ADMIN_PAT   (literal, common env-var spelling; caught by i-flag too)
 *   iamAdminPat     (camelCase variant)
 *
 * Self-test
 * ---------
 * Pass `--selftest` to create a temporary fixture, run the scan on it,
 * assert it catches the violation, and clean up. Exits 0 on success (guard
 * works correctly), exits 1 if the guard fails to catch a violation.
 *
 * Usage
 * -----
 *   node scripts/check-no-iam-admin-pat-in-dashboard.mjs            # normal scan
 *   node scripts/check-no-iam-admin-pat-in-dashboard.mjs --selftest # verify guard
 *
 * Exit codes: 0 = clean, 1 = violation detected
 */

import { readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_NAME = 'check-no-iam-admin-pat-in-dashboard.mjs';
const SPEC_NAME = 'dashboard-native-signup';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SCAN_DIRS = ['app', 'src'];

const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__']);

// Files to exclude from the scan (this script itself, to avoid self-match).
const SKIP_FILES = new Set([`scripts/${SCRIPT_NAME}`]);

const SOURCE_EXT = /\.(?:ts|tsx|js|mjs)$/;

// Skip test files by name pattern.
const TEST_FILE_PATTERN = /\.(?:test|spec)\./;

/**
 * The banned substrings. The regex is case-insensitive so a single pattern
 * covers all casing variants. iamAdminPat is a distinct camelCase form that
 * the i-flag alone catches since it has the same character sequence.
 *
 * We enumerate the canonical spellings in BANNED_LABELS so the error message
 * can show the exact matched form.
 */
const BANNED_REGEX = /iam.?admin.?pat/i;

// Label shown in violations, the canonical spellings we guard.
const BANNED_LABELS = [
  'iam-admin-pat',
  'iam_admin_pat',
  'IAM_ADMIN_PAT',
  'iamAdminPat',
];

// ---------------------------------------------------------------------------
// File walker
// ---------------------------------------------------------------------------

/** Recursively collect scannable source files under `dir`. */
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

/**
 * Returns an array of violation objects for `fullPath`.
 * Each violation has { rel, lineNo, matchedText }.
 */
function scanFile(fullPath, rel) {
  let body;
  try {
    body = readFileSync(fullPath, 'utf8');
  } catch {
    return [];
  }

  const lines = body.split(/\r?\n/);
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BANNED_REGEX.test(line)) {
      // Extract the matched text for display.
      const m = line.match(BANNED_REGEX);
      violations.push({
        rel,
        lineNo: i + 1,
        matchedText: m ? m[0] : '<matched>',
        lineContent: line.trim().slice(0, 160),
      });
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

  const allViolations = [];
  for (const { full, rel } of files) {
    const vs = scanFile(full, rel);
    allViolations.push(...vs);
  }

  return { violations: allViolations, fileCount: files.length };
}

function printViolations(violations) {
  for (const v of violations) {
    process.stderr.write(
      `\u274c ${v.rel}:${v.lineNo} \u2014 "${v.matchedText}"\n` +
        `   ${v.lineContent}\n\n`,
    );
  }
  process.stderr.write(
    `Why this exists\n` +
      `---------------\n` +
      `The IAM_ADMIN_PAT credential grants IAM_OWNER-level access to the\n` +
      `Zitadel instance. Spec "${SPEC_NAME}" (task 23) requires this credential\n` +
      `to stay out of the dashboard runtime. Signup flows use the narrowly-\n` +
      `scoped ZITADEL_SIGNUP_BOT_PAT (IAM_USER_MANAGER only) instead.\n` +
      `\n` +
      `Banned strings: ${BANNED_LABELS.join(', ')}\n` +
      `\n` +
      `If you need to reference this credential in a test, put it in a\n` +
      `*.test.ts or *.spec.ts file (those are excluded from the scan).\n`,
  );
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function runSelfTest() {
  // Create a temporary fixture file in a place the scanner will find it.
  const fixtureDir = join(ROOT, 'src');
  const fixturePath = join(fixtureDir, '_selftest_iam_admin_pat_fixture.ts');
  const fixtureContent = [
    '// SELFTEST FIXTURE, deleted immediately after the guard runs',
    '// This file is auto-generated by the --selftest flag.',
    `const secret = process.env.IAM_ADMIN_PAT;`,
    `export { secret };`,
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
    const fixtureViolations = violations.filter((v) =>
      v.rel.includes('_selftest_iam_admin_pat_fixture'),
    );
    caught = fixtureViolations.length > 0;
  } finally {
    try {
      unlinkSync(fixturePath);
    } catch {
      // Best-effort cleanup.
    }
  }

  if (caught) {
    process.stdout.write(
      `${SCRIPT_NAME} --selftest: PASS, guard correctly caught the synthetic violation.\n`,
    );
    process.exit(0);
  } else {
    process.stderr.write(
      `${SCRIPT_NAME} --selftest: FAIL, guard did NOT catch a deliberate IAM_ADMIN_PAT in a fixture file.\n` +
        `The guard is broken and must be fixed before merging.\n`,
    );
    process.exit(1);
  }
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

  process.stdout.write(
    `${SCRIPT_NAME}: clean (${fileCount} files scanned)\n`,
  );
  process.exit(0);
}
