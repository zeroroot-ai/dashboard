#!/usr/bin/env node
/**
 * Build guard: fail the build if any dashboard source file makes a direct
 * `fetch(` call to a Zitadel endpoint outside the canonical adapter module.
 *
 * Spec: dashboard-native-signup, task 24
 * Requirement: R4 criterion 1
 *
 * Background
 * ----------
 * All Zitadel HTTP calls must go through `src/lib/zitadel/` (specifically
 * `HttpZitadelAdminClient`). Scattering raw `fetch()` calls to Zitadel
 * endpoints across the codebase makes it impossible to audit or rotate the
 * bot PAT, apply retries consistently, or enforce Host-header spoofing.
 *
 * Detection heuristic
 * -------------------
 * A file is in violation when a `fetch(` call appears within 5 lines of any
 * line containing one of these Zitadel-identifying strings:
 *   - zitadel         (case-insensitive, catches env vars, URL literals, etc.)
 *   - gibson-zitadel  (the in-cluster service name)
 *   - /v2/users       (Zitadel User Service v2 path prefix)
 *   - /management/v1/ (Zitadel Management API v1 path prefix)
 *   - /admin/v1/      (Zitadel Admin API v1 path prefix)
 *
 * This is deliberately a heuristic (not an AST parser), it will catch
 * 99 % of accidental violations while remaining fast and dependency-free.
 *
 * What is scanned
 * ---------------
 * `.ts` and `.tsx` files under `app/` and `src/`, EXCLUDING:
 *   - `src/lib/zitadel/**` , the authorised adapter home
 *   - `node_modules/`, `.next/`
 *   - `__tests__/` directories, `*.test.*`, `*.spec.*`
 *   - Comment-only lines (lines whose first non-whitespace chars are `//` or `*`)
 *   - This script itself
 *
 * Self-test
 * ---------
 * Pass `--selftest` to write a temporary fixture, verify the guard catches it,
 * and clean up. Exits 0 if the guard correctly fires, 1 if it doesn't.
 *
 * Usage
 * -----
 *   node scripts/check-no-direct-zitadel-fetch.mjs            # normal scan
 *   node scripts/check-no-direct-zitadel-fetch.mjs --selftest # verify guard
 *
 * Exit codes: 0 = clean, 1 = violation detected
 */

import { readdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCRIPT_NAME = 'check-no-direct-zitadel-fetch.mjs';
const SPEC_NAME = 'dashboard-native-signup';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SCAN_DIRS = ['app', 'src'];

const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__']);

/** The authorised adapter directory, fetch() calls here are expected. */
const ADAPTER_DIR_REL = 'src/lib/zitadel';

const SKIP_FILES = new Set([`scripts/${SCRIPT_NAME}`]);

/** Only TypeScript source files are scanned (JS/MJS rarely touch Zitadel). */
const SOURCE_EXT = /\.(?:ts|tsx)$/;

/** Skip test files by name. */
const TEST_FILE_PATTERN = /\.(?:test|spec)\./;

/**
 * Zitadel-identifying strings. A line matching any of these within WINDOW
 * lines of a `fetch(` call is a violation.
 */
const ZITADEL_MARKERS = [
  'zitadel',        // catches env var names, URL literals, comments that describe the endpoint
  'gibson-zitadel', // in-cluster DNS name
  '/v2/users',      // User Service v2
  '/management/v1/',// Management API v1
  '/admin/v1/',     // Admin API v1
];

/** Lines within this many lines of a fetch() are considered "nearby". */
const WINDOW = 5;

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
      // Skip the authorised adapter directory entirely.
      if (rel === ADAPTER_DIR_REL || rel.startsWith(ADAPTER_DIR_REL + '/')) continue;
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
// Comment-line classifier
// ---------------------------------------------------------------------------

/**
 * Returns true if a source line is purely a comment and should be ignored.
 * We only skip lines whose first non-whitespace content is `//` or `*`
 * (JSDoc continuation). Lines mixing code and inline comments are still
 * scanned, `const url = zitadelUrl; // safe` is worth flagging.
 */
function isCommentLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*');
}

// ---------------------------------------------------------------------------
// Per-file scan
// ---------------------------------------------------------------------------

/**
 * Returns an array of violation objects for `fullPath`.
 * Each violation has { rel, fetchLine, zitadelLine, fetchContent, zitadelContent }.
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

  // Build index of fetch( lines and Zitadel-marker lines (skipping comments).
  const fetchLineNos = [];   // 0-based
  const zitadelLineNos = []; // 0-based + the matched marker

  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) continue;
    if (lines[i].includes('fetch(')) {
      fetchLineNos.push(i);
    }
    const lc = lines[i].toLowerCase();
    for (const marker of ZITADEL_MARKERS) {
      if (lc.includes(marker.toLowerCase())) {
        zitadelLineNos.push({ lineNo: i, marker });
        break; // only record once per line even if multiple markers match
      }
    }
  }

  // Cross-match: for each fetch( line, check if any Zitadel line is within WINDOW.
  // Track pairs we've already reported so we don't duplicate.
  const reported = new Set();

  for (const fl of fetchLineNos) {
    for (const { lineNo: zl, marker } of zitadelLineNos) {
      if (Math.abs(fl - zl) <= WINDOW) {
        const key = `${fl}:${zl}`;
        if (reported.has(key)) continue;
        reported.add(key);
        violations.push({
          rel,
          fetchLine: fl + 1,
          zitadelLine: zl + 1,
          marker,
          fetchContent: lines[fl].trim().slice(0, 160),
          zitadelContent: lines[zl].trim().slice(0, 160),
        });
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
      `\u274c ${v.rel}:${v.fetchLine} \u2014 fetch( near "${v.marker}" (zitadel ref at line ${v.zitadelLine})\n` +
        `   fetch  \u2192 ${v.fetchContent}\n` +
        `   marker \u2192 ${v.zitadelContent}\n\n`,
    );
  }
  process.stderr.write(
    `Why this exists\n` +
      `---------------\n` +
      `Spec "${SPEC_NAME}" (task 24, R4 criterion 1) requires ALL Zitadel\n` +
      `HTTP calls to go through the adapter at src/lib/zitadel/.\n` +
      `Direct fetch() calls to Zitadel URLs anywhere else in the codebase:\n` +
      `  - bypass retry + back-off logic\n` +
      `  - bypass the forged Host header required for in-cluster routing\n` +
      `  - make PAT rotation impossible to audit\n` +
      `\n` +
      `Fix: use HttpZitadelAdminClient (or the singleton from\n` +
      `src/lib/zitadel/admin-client-factory.ts) instead of fetch().\n` +
      `\n` +
      `Zitadel markers checked: ${ZITADEL_MARKERS.join(', ')}\n` +
      `Window size: ${WINDOW} lines\n`,
  );
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

function runSelfTest() {
  // Write a fixture in src/ (not in src/lib/zitadel) so the scanner will pick it up.
  const fixturePath = join(ROOT, 'src', '_selftest_zitadel_fetch_fixture.ts');
  const fixtureContent = [
    '// SELFTEST FIXTURE, auto-deleted immediately after the guard runs',
    'async function badExample() {',
    '  const url = `http://gibson-zitadel:8080/management/v1/users`;',
    '  const resp = await fetch(url, { method: "GET" });',
    '  return resp.json();',
    '}',
    'export { badExample };',
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
      v.rel.includes('_selftest_zitadel_fetch_fixture'),
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
      `${SCRIPT_NAME} --selftest: FAIL, guard did NOT catch a deliberate fetch(zitadel) in a fixture file.\n` +
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
