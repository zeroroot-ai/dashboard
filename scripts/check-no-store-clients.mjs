#!/usr/bin/env node
/**
 * check-no-store-clients.mjs
 *
 * Build-time guard enforcing the thin-client invariant: the dashboard must
 * not directly depend on or import backing-store client libraries.
 *
 * ## Background
 *
 * As part of the dashboard-no-backing-store-clients spec (dashboard#584), all
 * direct Postgres (pg/pg-pool), Redis (redis/ioredis), graph (neo4j/neo4j-driver),
 * and tracing (langfuse) client dependencies were removed. The dashboard is a
 * thin client, all backing-store access goes through the daemon via ConnectRPC.
 *
 * This guard prevents re-introduction of those dependencies.
 *
 * ## What is checked
 *
 * 1. **package.json dependencies**, `dependencies`, `devDependencies`, and
 *    `peerDependencies` must not contain any of the banned package names.
 *
 * 2. **Source file imports**, any import (type OR value) of a banned package
 *    in any `.ts` / `.tsx` file under the scan roots. Type-only imports
 *    (`import type { ... } from 'pkg'`) are also banned: they break the
 *    typecheck once `@types/<pkg>` is removed and signal lingering
 *    backing-store coupling that should go through the daemon instead.
 *
 * ## Banned packages
 *
 *   - `langfuse`           , direct Langfuse API client
 *   - `redis`              , ioredis / node-redis client
 *   - `ioredis`            , ioredis client
 *   - `pg`                 , node-postgres client
 *   - `@types/pg`          , TypeScript types for pg (signals active pg usage)
 *   - `pg-pool`            , connection pool for pg
 *   - `@types/pg-pool`     , TypeScript types for pg-pool
 *   - `neo4j-driver`       , Neo4j JavaScript driver
 *   - `neogma`             , OGM wrapper for neo4j-driver
 *
 * ## Self-test
 *
 * Pass `--selftest` to synthesise a fake `package.json` entry and a source
 * file with a banned import, run the scanner against them, and assert both
 * are caught. Cleans up after itself. Exits 0 on success, 1 on failure.
 *
 * ## Usage
 *
 *   node scripts/check-no-store-clients.mjs            # FAIL on any violation
 *   node scripts/check-no-store-clients.mjs --selftest # assert detection
 *
 * Wired into `pnpm prebuild` as a hard-fail guard (dashboard#590).
 */

import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, sep, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_NAME = 'check-no-store-clients.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------
// Banned package names
// ---------------------------------------------------------------------------

/**
 * Each entry defines:
 *  - `name` , exact package.json key (matches both bare deps and @scope/pkg)
 *  - `label`, human-readable reason shown in violation output
 */
const BANNED_PACKAGES = [
  { name: 'langfuse', label: 'direct Langfuse API client, use Gibson Traces via the daemon RPC instead' },
  { name: 'redis', label: 'node-redis client, backing-store access goes through the daemon' },
  { name: 'ioredis', label: 'ioredis client, backing-store access goes through the daemon' },
  { name: 'pg', label: 'node-postgres client, backing-store access goes through the daemon' },
  { name: '@types/pg', label: 'TypeScript types for pg, signals pg is still an active dependency' },
  { name: 'pg-pool', label: 'pg-pool, backing-store access goes through the daemon' },
  { name: '@types/pg-pool', label: 'TypeScript types for pg-pool, signals pg-pool is still an active dependency' },
  { name: 'neo4j-driver', label: 'Neo4j JavaScript driver, backing-store access goes through the daemon' },
  { name: 'neogma', label: 'Neo4j OGM, backing-store access goes through the daemon' },
];

/** Set of banned package names for quick lookup. */
const BANNED_PACKAGE_NAMES = new Set(BANNED_PACKAGES.map((p) => p.name));

// ---------------------------------------------------------------------------
// Source scan configuration
// ---------------------------------------------------------------------------

const SCAN_DIRS = ['app', 'src'];
const SCAN_FILES = ['auth.ts', 'middleware.ts'];
const EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'build',
  'coverage',
  'gen',
]);
const SKIP_FILE_MARKERS = ['.test.', '.spec.', '.stories.'];

// ---------------------------------------------------------------------------
// Import-pattern detection
// ---------------------------------------------------------------------------

/**
 * Matches any import (type OR value) whose module specifier is a banned package.
 *
 * We match the module specifier at the END of the import statement. A banned
 * import looks like:
 *   import { something } from 'pkg';       → banned
 *   import * as foo from "pkg/sub/path";   → banned
 *   import 'pkg';                          → banned (side-effect import)
 *   import type { T } from 'pkg';          → banned (a type-only import of a
 *                                            store package still breaks the
 *                                            typecheck once @types/<pkg> is
 *                                            removed, and signals lingering
 *                                            backing-store coupling)
 *   // import { something } from 'pkg';    → allowed (comment)
 *
 * The pattern captures the trailing module specifier so we can check against
 * BANNED_PACKAGE_NAMES.
 */
const IMPORT_RE = /^.*\bfrom\s+['"]([^'"]+)['"]/;
const SIDE_EFFECT_IMPORT_RE = /^\s*import\s+['"]([^'"]+)['"]/;

function isCommentLine(line) {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

/**
 * Return the package name from a module specifier (strips sub-paths).
 * e.g. 'pg/pool' → 'pg', '@types/pg' → '@types/pg', 'langfuse/node' → 'langfuse'
 */
function extractPackageName(specifier) {
  if (specifier.startsWith('@')) {
    // Scoped package: @scope/name[/sub-path]
    const parts = specifier.split('/');
    return parts.slice(0, 2).join('/');
  }
  // Unscoped: name[/sub-path]
  return specifier.split('/')[0];
}

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

/**
 * Scan package.json for banned dependencies.
 * Checks `dependencies`, `devDependencies`, `peerDependencies`.
 */
function scanPackageJson() {
  const pkgPath = join(ROOT, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    return [];
  }
  const violations = [];
  const depGroups = ['dependencies', 'devDependencies', 'peerDependencies'];
  for (const group of depGroups) {
    const deps = pkg[group] ?? {};
    for (const name of Object.keys(deps)) {
      if (BANNED_PACKAGE_NAMES.has(name)) {
        const banned = BANNED_PACKAGES.find((b) => b.name === name);
        violations.push({
          source: `package.json[${group}]`,
          text: `"${name}": "${deps[name]}"`,
          label: banned?.label ?? 'banned backing-store client',
        });
      }
    }
  }
  return violations;
}

/**
 * Scan a single source file for banned runtime imports.
 */
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

    // Check for `from 'pkg'` style imports (non-type-only)
    const m = IMPORT_RE.exec(raw);
    if (m) {
      const pkg = extractPackageName(m[1]);
      if (BANNED_PACKAGE_NAMES.has(pkg)) {
        const banned = BANNED_PACKAGES.find((b) => b.name === pkg);
        violations.push({
          file: filePath,
          line: i + 1,
          text: raw.trim(),
          label: banned?.label ?? 'banned backing-store client import',
        });
        continue;
      }
    }

    // Check for side-effect imports: `import 'pkg'`
    const sm = SIDE_EFFECT_IMPORT_RE.exec(raw);
    if (sm) {
      const pkg = extractPackageName(sm[1]);
      if (BANNED_PACKAGE_NAMES.has(pkg)) {
        const banned = BANNED_PACKAGES.find((b) => b.name === pkg);
        violations.push({
          file: filePath,
          line: i + 1,
          text: raw.trim(),
          label: banned?.label ?? 'banned backing-store client side-effect import',
        });
      }
    }
  }
  return violations;
}

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
      // File doesn't exist, fine.
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

/**
 * The selftest creates:
 *  1. A fake package.json fragment that includes a banned dep entry (synthesised
 *     in-memory, we DON'T touch the real package.json).
 *  2. A synthetic source fixture with a banned runtime import.
 *
 * Both are checked against the scanner and must be caught.
 */
function runSelftest() {
  // --- 1. Banned dep in package.json ---
  // Temporarily patch the real package.json in-memory only (no file write).
  const pkgPath = join(ROOT, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch {
    console.error(`[${SCRIPT_NAME}] SELFTEST FAILED: cannot read package.json`);
    return 1;
  }

  // Inject a banned dep into a copy (not the real file).
  const fakePkg = {
    ...pkg,
    dependencies: { ...(pkg.dependencies ?? {}), redis: '^5.0.0' },
  };
  const fakePkgPath = join(ROOT, '__check_store_clients_selftest_pkg.json');
  writeFileSync(fakePkgPath, JSON.stringify(fakePkg));

  // Scan the fake package.json.
  let fakePkgViolations = [];
  try {
    const fp = JSON.parse(readFileSync(fakePkgPath, 'utf8'));
    for (const group of ['dependencies', 'devDependencies', 'peerDependencies']) {
      const deps = fp[group] ?? {};
      for (const name of Object.keys(deps)) {
        if (BANNED_PACKAGE_NAMES.has(name)) {
          fakePkgViolations.push(name);
        }
      }
    }
  } finally {
    try { unlinkSync(fakePkgPath); } catch { /* best-effort */ }
  }

  // --- 2. Banned import in source file ---
  const fixtureContent = [
    '// This comment mentions redis, must NOT be flagged',
    '// import { createClient } from "redis";, comment, not code',
    '',
    '// The following MUST be flagged:',
    "import { createClient } from 'redis';",
    'import neo4jPkg from "neo4j-driver";',
    "import { Pool } from 'pg';",
  ].join('\n');

  const fixturePath = join(ROOT, 'src', '__check_store_clients_selftest.ts');
  writeFileSync(fixturePath, fixtureContent + '\n');

  let fixtureViolations = [];
  try {
    fixtureViolations = scanFile(fixturePath);
  } finally {
    try { unlinkSync(fixturePath); } catch { /* best-effort */ }
  }

  // --- Assert ---
  let passed = true;

  if (!fakePkgViolations.includes('redis')) {
    console.error(`[${SCRIPT_NAME}] SELFTEST FAILED: banned dep 'redis' in package.json not caught`);
    passed = false;
  }

  const expectedImportPkgs = new Set(['redis', 'neo4j-driver', 'pg']);
  const foundImportPkgs = new Set(
    fixtureViolations.map((v) => extractPackageName(v.text.match(/from\s+['"]([^'"]+)['"]/)?.[1] ?? ''))
  );
  for (const pkg of expectedImportPkgs) {
    if (!foundImportPkgs.has(pkg)) {
      console.error(`[${SCRIPT_NAME}] SELFTEST FAILED: banned import '${pkg}' not caught`);
      passed = false;
    }
  }

  // Ensure comment lines were NOT flagged (no violations from lines 1-3)
  const commentFalsePositives = fixtureViolations.filter((v) => v.line <= 3);
  if (commentFalsePositives.length > 0) {
    console.error(`[${SCRIPT_NAME}] SELFTEST FAILED: comment lines incorrectly flagged`);
    for (const v of commentFalsePositives) {
      console.error(`  L${v.line}: ${v.text}`);
    }
    passed = false;
  }

  if (passed) {
    console.log(
      `[${SCRIPT_NAME}] --selftest OK: ` +
        `banned dep caught in package.json, ` +
        `${fixtureViolations.length} banned imports caught in source fixture, ` +
        `comments not flagged`,
    );
  }
  return passed ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Main scan
// ---------------------------------------------------------------------------

function runScan() {
  const pkgViolations = scanPackageJson();
  const files = collectFiles();
  const importViolations = files.flatMap(scanFile);
  const total = pkgViolations.length + importViolations.length;

  if (total === 0) {
    console.log(
      `[${SCRIPT_NAME}] OK: no backing-store client deps or imports found ` +
        `(${files.length} files scanned, package.json clean)`,
    );
    return 0;
  }

  console.error(
    `\n[${SCRIPT_NAME}] FAIL, ${total} backing-store client violation(s) found.`,
  );
  console.error(
    'The dashboard is a thin client. All backing-store access goes through the daemon.',
  );
  console.error(
    'Remove the banned dependency / import and use the appropriate daemon RPC instead.\n',
  );

  if (pkgViolations.length > 0) {
    console.error('  package.json:');
    for (const v of pkgViolations) {
      console.error(`    ${v.source}: ${v.text}`);
      console.error(`      → ${v.label}`);
    }
  }

  if (importViolations.length > 0) {
    // Group by file.
    const byFile = new Map();
    for (const v of importViolations) {
      const key = relative(ROOT, v.file);
      if (!byFile.has(key)) byFile.set(key, []);
      byFile.get(key).push(v);
    }
    for (const [file, vs] of byFile) {
      console.error(`  ${file}`);
      for (const v of vs) {
        console.error(`    L${v.line}: ${v.text}`);
        console.error(`      → ${v.label}`);
      }
    }
  }

  console.error(`\n[${SCRIPT_NAME}] Total violations: ${total} (exit 1, HARD FAIL)`);
  return 1;
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
