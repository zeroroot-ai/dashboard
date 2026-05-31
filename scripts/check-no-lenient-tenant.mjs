#!/usr/bin/env node
/**
 * check-no-lenient-tenant.mjs
 *
 * Build-time guard (WARN mode) enforcing the single fail-closed active-tenant
 * resolver contract introduced in dashboard#568.
 *
 * ## Background
 *
 * Two tenant-resolution paths exist today:
 *
 *  1. Strict / fail-closed: `requireActiveTenant()` (alias: `getActiveTenant()`)
 *     in `src/lib/auth/active-tenant.ts`. HMAC-validates the `gibson_active_tenant`
 *     cookie, re-checks FGA memberships, throws `NoActiveTenantError` or
 *     `StaleActiveTenantError` when the tenant cannot be confirmed.
 *
 *  2. Lenient / smeared: `session.user.tenantId` from `getServerSession()`,
 *     often used with `|| 'default'`, `|| ''`, or `?? undefined` fallbacks that
 *     paper over the absent-tenant case rather than surfacing it.
 *
 * The goal is to migrate every endpoint to path 1 and delete path 2. This guard
 * flags lenient usages so the migration can be tracked. It is intentionally in
 * WARN mode (exits 0) during the migration period; it will be flipped to FAIL
 * mode in the lock-in slice (dashboard#583) once all endpoints are converted.
 *
 * ## Detected patterns
 *
 *  Pattern A — `session.user.tenantId` used as a tenant value.
 *    Matches `session.user.tenantId` and `session?.user?.tenantId`
 *    (non-comment code lines, non-test files).
 *
 *  Pattern B — tenant-id smear: `|| 'default'`, `|| ''` applied to a tenant id.
 *    Matches the two most common smear patterns found in existing endpoints:
 *      `<expr>.tenantId || 'default'`
 *      `<expr>.tenantId || ''`
 *
 *  Pattern C — `?? undefined` applied to a tenantId expression.
 *    Matches `<expr>.tenantId ?? undefined` (which defeats the optional-chaining
 *    type narrowing without providing a real value).
 *
 *  Pattern D — import of a second tenant-resolver (anything other than
 *    `requireActiveTenant` / `getActiveTenant` / `readRawActiveTenant` from the
 *    active-tenant module that purports to return a tenantId).
 *    Currently not detected by pattern matching — tracked as a documentation
 *    requirement for the lock-in slice.
 *
 * ## Self-test
 *
 * Pass `--selftest` to write a synthetic fixture that exercises each detected
 * pattern, run the scanner against it, and assert all patterns are caught.
 * Cleans up the fixture on exit. Exits 0 on success, 1 if any pattern is missed.
 *
 * ## Usage
 *
 *   node scripts/check-no-lenient-tenant.mjs            # WARN mode (exits 0)
 *   node scripts/check-no-lenient-tenant.mjs --selftest # assert detection (exits 0/1)
 *
 * Wired into `pnpm prebuild` in WARN mode so the build never fails here.
 * The lock-in slice (dashboard#583) will change this to a hard FAIL.
 */

import { readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, sep, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_NAME = 'check-no-lenient-tenant.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Files and directories to scan.
const SCAN_DIRS = ['app', 'src'];
const SCAN_FILES = ['auth.ts', 'middleware.ts'];
const EXTENSIONS = new Set(['.ts', '.tsx']);

// Directories / file-marker patterns to skip entirely.
const SKIP_DIR_NAMES = new Set(['node_modules', '.next', '.turbo', 'dist', 'build', 'coverage', '__tests__', 'gen']);
const SKIP_FILE_MARKERS = ['.test.', '.spec.', '.stories.'];

/**
 * Forbidden patterns. Each entry has:
 *  - `id`      — stable identifier used in the selftest.
 *  - `pattern` — RegExp to match against each non-comment source line.
 *  - `label`   — human-readable description of the violation.
 */
const FORBIDDEN_PATTERNS = [
  {
    id: 'session-user-tenantId',
    pattern: /\bsession(?:\?\.|\.)user(?:\?\.|\.)tenantId\b/,
    label:
      'session.user.tenantId used as a tenant value — use requireActiveTenant() from src/lib/auth/active-tenant instead',
  },
  {
    id: 'tenantId-or-default',
    pattern: /\.tenantId\s*\|\|\s*'default'/,
    label:
      ".tenantId || 'default' smear — requireActiveTenant() throws when tenant is absent; catch with activeTenantApiResponse/activeTenantActionResult/activeTenantPageRedirect instead",
  },
  {
    id: 'tenantId-or-empty',
    pattern: /\.tenantId\s*\|\|\s*''/,
    label:
      ".tenantId || '' smear — requireActiveTenant() throws when tenant is absent; catch with the appropriate error-mapping helper instead",
  },
  {
    id: 'tenantId-nullish-undefined',
    pattern: /\.tenantId\s*\?\?\s*undefined\b/,
    label:
      ".tenantId ?? undefined smear — this is a no-op coercion that hides the absent-tenant case; use requireActiveTenant() and handle the thrown error",
  },
];

// ---------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (SKIP_FILE_MARKERS.some((m) => name.includes(m))) continue;
    if (full.includes(`${sep}e2e${sep}`)) continue;
    const dot = name.lastIndexOf('.');
    if (dot < 0 || !EXTENSIONS.has(name.slice(dot))) continue;
    out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function scanFile(filePath) {
  let src;
  try {
    src = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  const violations = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (isCommentLine(raw)) continue;
    // Skip occurrences that only appear after a line-trailing comment marker.
    const commentIdx = raw.indexOf('//');
    for (const { id, pattern, label } of FORBIDDEN_PATTERNS) {
      const m = pattern.exec(raw);
      if (!m) continue;
      if (commentIdx !== -1 && commentIdx < m.index) continue;
      violations.push({ file: filePath, line: i + 1, text: raw.trim(), id, label });
    }
  }
  return violations;
}

function collectFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    walk(join(ROOT, dir), files);
  }
  for (const name of SCAN_FILES) {
    const abs = join(ROOT, name);
    try {
      if (statSync(abs).isFile()) files.push(abs);
    } catch {
      // File doesn't exist — fine.
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/**
 * Fixture contents — one line per forbidden pattern + one clean line that
 * must NOT be flagged (a comment that mentions the pattern).
 */
const SELFTEST_FIXTURE = [
  '// This is a comment — the guard must NOT flag the lines below from the comment:',
  '// session.user.tenantId is forbidden in live code',
  '',
  '// The following are REAL code lines that MUST be flagged:',
  "const a = session.user.tenantId;           // pattern A: session.user.tenantId",
  "const b = session?.user?.tenantId;         // pattern A: session?.user?.tenantId",
  "const c = session.user.tenantId || 'default'; // pattern B: || 'default'",
  "const d = session.user.tenantId || '';     // pattern C: || ''",
  "const e = session.user.tenantId ?? undefined; // pattern D: ?? undefined",
].join('\n');

const SELFTEST_EXPECTED_IDS = new Set([
  'session-user-tenantId',   // line 5 (session.user.tenantId)
  'session-user-tenantId',   // line 6 (session?.user?.tenantId — same id)
  'tenantId-or-default',     // line 7
  'tenantId-or-empty',       // line 8
  'tenantId-nullish-undefined', // line 9
]);

function runSelftest() {
  const fixturePath = join(ROOT, 'src', '__check_lenient_tenant_selftest.ts');
  writeFileSync(fixturePath, SELFTEST_FIXTURE + '\n');
  let passed = true;
  try {
    const violations = scanFile(fixturePath);
    const foundIds = new Set(violations.map((v) => v.id));

    for (const id of SELFTEST_EXPECTED_IDS) {
      if (!foundIds.has(id)) {
        console.error(`[${SCRIPT_NAME}] SELFTEST FAILED: pattern '${id}' was NOT caught`);
        passed = false;
      }
    }

    // Lines 1-4 are comments / blank — none should be flagged.
    const commentFalsePositives = violations.filter((v) => v.line <= 4);
    if (commentFalsePositives.length > 0) {
      console.error(`[${SCRIPT_NAME}] SELFTEST FAILED: comment lines were incorrectly flagged:`);
      for (const v of commentFalsePositives) {
        console.error(`  L${v.line}: ${v.text}`);
      }
      passed = false;
    }

    if (passed) {
      console.log(
        `[${SCRIPT_NAME}] --selftest OK: all ${SELFTEST_EXPECTED_IDS.size} patterns detected, comments not flagged`,
      );
    }
  } finally {
    try {
      unlinkSync(fixturePath);
    } catch {
      // best-effort cleanup
    }
  }
  return passed ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

function runScan() {
  const files = collectFiles();
  const allViolations = files.flatMap(scanFile);

  if (allViolations.length === 0) {
    console.log(
      `[${SCRIPT_NAME}] WARN-mode clean: no lenient-tenant patterns found (${files.length} files scanned)`,
    );
    return 0;
  }

  // Group by file for readable output.
  const byFile = new Map();
  for (const v of allViolations) {
    const key = relative(ROOT, v.file);
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key).push(v);
  }

  console.warn(
    `\n[${SCRIPT_NAME}] WARN — ${allViolations.length} lenient-tenant pattern(s) found.`,
  );
  console.warn(
    'These will become HARD FAILURES in dashboard#583 (lock-in slice).',
  );
  console.warn('Migrate each call-site to requireActiveTenant() from src/lib/auth/active-tenant.\n',
  );

  for (const [file, vs] of byFile) {
    console.warn(`  ${file}`);
    for (const v of vs) {
      console.warn(`    L${v.line}: ${v.label}`);
      console.warn(`      ${v.text}`);
    }
  }

  console.warn(`\n[${SCRIPT_NAME}] Total violations: ${allViolations.length} (exit 0 — WARN mode)`);
  // WARN mode: always exit 0 so the build is not blocked.
  return 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const mode = process.argv[2];
if (mode === '--selftest') {
  process.exit(runSelftest());
} else {
  process.exit(runScan());
}
