#!/usr/bin/env node
/**
 * Build guard: fail the build if `src/lib/gibson-client.ts` (or any
 * companion file in the user-client family) contains a top-level static
 * import that resolves to `@/src/lib/spiffe/` or names `getSpiffeJwt`.
 *
 * Spec: dashboard-fga-user-identity (R1.4)
 *
 * Background
 * ----------
 * The dashboard regressed once before by collapsing its user-acting and
 * workload-acting daemon transports onto a single SPIFFE JWT-SVID path.
 * That broke per-user FGA enforcement and audit attribution. This guard
 * prevents the same regression by trip-wiring on a SPIFFE import inside
 * the user-acting transport.
 *
 * The user-acting transport DOES retain a SPIFFE fallback in its
 * backout branch (USE_USER_TOKEN_FORWARDING=false), but the import is
 * dynamic (`await import('./spiffe/jwt-svid')`) so it never appears as
 * a top-level static import. This guard only matches static imports;
 * dynamic imports are allowed.
 *
 * Detection
 * ---------
 * Static imports are matched by:
 *   ^\s*import\b ... \bfrom\s+['"]@/src/lib/spiffe/...['"]
 *   ^\s*import\b ... \bfrom\s+['"]\.[/.]+spiffe/...['"]
 *   import { getSpiffeJwt }  // the named symbol, regardless of source
 *
 * Comment-only mentions are allowed so explanatory comments don't
 * trip the guard.
 *
 * What is scanned
 * ---------------
 * Only the user-acting transport files:
 *   - src/lib/gibson-client.ts
 *
 * Self-test
 * ---------
 * Pass `--selftest` to write a temporary fixture, verify the guard
 * catches it, and clean up.
 *
 * Usage
 * -----
 *   node scripts/check-no-spiffe-in-user-client.mjs
 *   node scripts/check-no-spiffe-in-user-client.mjs --selftest
 *
 * Exit codes: 0 = clean, 1 = violation detected
 */

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_NAME = 'check-no-spiffe-in-user-client.mjs';
const SPEC_NAME = 'dashboard-fga-user-identity';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/**
 * Files that MUST NOT statically import the SPIFFE module. Add a path
 * here when a new user-client companion is created.
 */
const USER_CLIENT_FILES = ['src/lib/gibson-client.ts'];

/**
 * Patterns that flag a static import of the SPIFFE module. Each entry
 * is a regex applied to non-comment source lines.
 *
 * NOTE: These match `import ... from '...'` only, they do NOT match
 * `await import('...')`. The user-acting transport's backout branch is
 * allowed to dynamic-import the SPIFFE helper.
 */
const STATIC_IMPORT_PATTERNS = [
  /^\s*import\b[^;\n]*\bfrom\s+['"]@\/src\/lib\/spiffe\//,
  /^\s*import\b[^;\n]*\bfrom\s+['"]\.\.?\/[^'"]*spiffe\//,
  /^\s*import\b[^;\n]*\bgetSpiffeJwt\b[^;\n]*\bfrom\s+['"]/,
];

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

function scanFile(absPath) {
  const violations = [];
  let contents;
  try {
    contents = readFileSync(absPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return violations; // optional file
    throw err;
  }
  const lines = contents.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;
    for (const pattern of STATIC_IMPORT_PATTERNS) {
      const m = pattern.exec(line);
      if (!m) continue;
      const commentStart = line.indexOf('//');
      if (commentStart !== -1 && commentStart < m.index) continue;
      violations.push({ line: i + 1, snippet: line.trim() });
      break;
    }
  }
  return violations;
}

function scan() {
  let total = 0;
  for (const rel of USER_CLIENT_FILES) {
    const path = resolve(ROOT, rel);
    const v = scanFile(path);
    if (v.length === 0) continue;
    total += v.length;
    console.error(`\n${rel}`);
    for (const { line, snippet } of v) {
      console.error(`  L${line}: static SPIFFE import, only the workload (admin) client may import the SPIFFE module statically`);
      console.error(`    ${snippet}`);
    }
  }
  return total;
}

function selftest() {
  // Plant a violation at the top of gibson-client.ts (preserved + restored).
  const target = resolve(ROOT, 'src/lib/gibson-client.ts');
  const original = readFileSync(target, 'utf8');
  const planted =
    "import { getSpiffeJwt } from './spiffe/jwt-svid';\n" + original;
  writeFileSync(target, planted, 'utf8');
  try {
    const v = scanFile(target);
    if (v.length === 0) {
      console.error(`[${SCRIPT_NAME}] SELFTEST FAILED: guard did not fire on a planted static SPIFFE import`);
      process.exit(1);
    }
    console.log(`[${SCRIPT_NAME}] selftest OK, guard caught the planted violation`);
  } finally {
    writeFileSync(target, original, 'utf8');
  }
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  selftest();
  process.exit(0);
}

const violations = scan();
if (violations > 0) {
  console.error(`\n[${SCRIPT_NAME}] FAIL, ${violations} violation(s). Spec: ${SPEC_NAME}`);
  console.error('The user-acting daemon client must NOT statically import the SPIFFE module.');
  console.error('Use a dynamic `await import(...)` inside the backout branch only.');
  process.exit(1);
}
console.log(`[${SCRIPT_NAME}] OK, no static SPIFFE imports in user-client files`);

// Suppress unused warning on relative, used in stub-only build.
void relative;
