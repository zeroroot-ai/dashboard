#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * check-no-direct-admin-rpc.mjs
 *
 * Build-time guard enforcing ADR-0058: tenant administration lives in the
 * focused services of `gibson.tenant.v1`. No source file under `src/` or
 * `app/` may import generated TypeScript bindings from a path that the move
 * deleted.
 *
 * Forbidden paths. This list is the same as `FORBIDDEN_GEN_PATHS` below, and
 * `--selftest` fails when an entry of the array is not in this header:
 *
 *   - src/gen/gibson/daemon/admin
 *   - src/gen/gibson/platform
 *   - src/gen/gibson/admin/v1/
 *   - src/gen/gibson/authz/v1/
 *   - src/gen/gibson/budget/v1/
 *   - src/gen/gibson/usage/v1/
 *   - src/gen/gibson/user/v1/
 *
 * Each entry of the array has a comment that names where its services went.
 *
 * The guard is intentionally path-based so a `proto:generate` run that
 * accidentally regenerates a deleted directory is caught immediately at
 * next build, before any code references it.
 *
 * Permitted paths: each `src/gen/` subtree that is not in the array. For
 * example `src/gen/gibson/tenant/v1/` and `src/gen/gibson/daemon/v1/`.
 *
 * Exemptions:
 *   - node_modules, .next, build output
 *   - Test files (*.test.*, *.spec.*, __tests__/, e2e/), may reference
 *     deleted paths in historical comments or negative assertions.
 *   - Lines that are purely comments (start with // or inside block comments)
 *
 * Usage:
 *   node scripts/check-no-direct-admin-rpc.mjs             # scan src/ and app/
 *   node scripts/check-no-direct-admin-rpc.mjs --selftest  # prove it can fail
 *
 * `--selftest` writes one fixture for each forbidden path into a temporary
 * directory and asserts that the scan reports each one. It also asserts that
 * a permitted import, a near-miss name and a comment pass. It is listed in
 * check-guard-selftests.mjs.
 *
 * Spec: dashboard#336 (ADR-0058 platform-sdk admin surface removal).
 */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = join(__dirname, '..');

/**
 * Paths inside src/gen/ that are forbidden after ADR-0058:
 *   - DaemonAdminService was deleted from platform-sdk; its RPCs moved to
 *     DaemonService (OSS SDK). Importing daemon_admin_pb is now forbidden.
 *   - PlatformOperatorService was moved to DaemonOperatorService (daemon/operator/v1).
 *   - gibson.admin.v1 was decomposed into gibson.tenant.v1.* (ADR-0058).
 *     TenantAdminService, SecretsAdminService, GrantsAdminService, PluginsAdminService
 *     are now MembershipService, SecretsService, GrantsService, PluginAdminService.
 *   - gibson.authz.v1, gibson.budget.v1, gibson.usage.v1, gibson.user.v1 were
 *     all moved to gibson.tenant.v1.* (ADR-0058).
 *
 * All callers must import from src/gen/gibson/tenant/v1/ instead.
 */
// Each path includes a trailing path separator so e.g. `budget` does not
// accidentally match `budget_status` (which is a distinct OSS SDK package
// and remains valid). The check tests for substring containment, so
// appending `/v1/` or `/` ensures only the intended directory is matched.
const FORBIDDEN_GEN_PATHS = [
  'src/gen/gibson/daemon/admin',
  'src/gen/gibson/platform',     // PlatformOperatorService, moved to DaemonOperatorService (daemon/operator/v1)
  'src/gen/gibson/admin/v1/',    // gibson.admin.v1, decomposed into gibson.tenant.v1.* (ADR-0058)
  'src/gen/gibson/authz/v1/',    // gibson.authz.v1, moved to gibson.tenant.v1.ModelAccessService (ADR-0058)
  'src/gen/gibson/budget/v1/',   // gibson.budget.v1, moved to gibson.tenant.v1.BudgetService (ADR-0058)
  'src/gen/gibson/usage/v1/',    // gibson.usage.v1, moved to gibson.tenant.v1.UsageService (ADR-0058)
  'src/gen/gibson/user/v1/',     // gibson.user.v1, moved to gibson.tenant.v1.UserService (ADR-0058)
];

/** Directories and file patterns to skip entirely. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.tmp',
  'out',
  'dist',
  '__generated__',
]);

const SKIP_FILE_PATTERNS = [
  /\.test\.(ts|tsx|mjs)$/,
  /\.spec\.(ts|tsx|mjs)$/,
  /__tests__/,
  /\/e2e\//,
];

/**
 * Recursively collect all .ts and .tsx files under `dir`, excluding
 * SKIP_DIRS and test files.
 */
function collectFiles(dir) {
  const results = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...collectFiles(full));
    } else if (stat.isFile()) {
      const ext = extname(full);
      if (ext !== '.ts' && ext !== '.tsx') continue;
      if (SKIP_FILE_PATTERNS.some((p) => p.test(full))) continue;
      results.push(full);
    }
  }
  return results;
}

/** Strip single-line comments and return only non-comment content on a line. */
function hasNonCommentMatch(line, pattern) {
  // Remove leading whitespace for block-comment-start detection
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//')) return false;
  if (trimmed.startsWith('*')) return false;
  // Inline: strip the trailing // comment before checking
  const codePart = line.replace(/\/\/.*$/, '');
  return codePart.includes(pattern);
}

/**
 * Scan each root and return one violation for each forbidden path on each
 * non-comment line. `base` makes the reported file path relative.
 */
function scan(roots, base) {
  const violations = [];
  for (const file of roots.flatMap((root) => collectFiles(root))) {
    let content;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const forbidden of FORBIDDEN_GEN_PATHS) {
        if (hasNonCommentMatch(lines[i], forbidden)) {
          const rel = file.startsWith(base) ? file.slice(base.length + 1) : file;
          violations.push({ file: rel, line: i + 1, forbidden });
        }
      }
    }
  }
  return violations;
}

function main() {
  const violations = scan(
    [join(DASHBOARD_ROOT, 'src'), join(DASHBOARD_ROOT, 'app')],
    DASHBOARD_ROOT,
  );

  for (const v of violations) {
    process.stderr.write(
      `check-no-direct-admin-rpc: ERROR: ${v.file}:${v.line} imports from deleted admin gen path: ${v.forbidden}\n`,
    );
  }

  if (violations.length > 0) {
    process.stderr.write(
      `\ncheck-no-direct-admin-rpc: ${violations.length} violation(s) found.\n` +
        '  Forbidden gen paths detected. Migration guide:\n' +
        '    ADR-0058: src/gen/gibson/daemon/admin → src/gen/gibson/daemon/v1/daemon_pb\n' +
        '    ADR-0058: src/gen/gibson/admin/v1 → src/gen/gibson/tenant/v1/{membership,secrets,grants,plugin_admin}_pb\n' +
        '    ADR-0058: src/gen/gibson/authz/v1 → src/gen/gibson/tenant/v1/model_access_pb\n' +
        '    ADR-0058: src/gen/gibson/budget/v1 → src/gen/gibson/tenant/v1/budget_pb\n' +
        '    ADR-0058: src/gen/gibson/usage/v1 → src/gen/gibson/tenant/v1/usage_pb\n' +
        '    ADR-0058: src/gen/gibson/user/v1 → src/gen/gibson/tenant/v1/user_pb\n',
    );
    process.exit(1);
  }

  process.stdout.write('check-no-direct-admin-rpc: clean\n');
}

/**
 * Prove that the guard can fail. One fixture file for each forbidden path
 * must give exactly one violation that names that path. Three compliant
 * files must give none.
 */
function selftest() {
  const dir = mkdtempSync(join(tmpdir(), 'check-no-direct-admin-rpc-'));
  const failures = [];
  try {
    const src = join(dir, 'src');
    mkdirSync(src, { recursive: true });

    FORBIDDEN_GEN_PATHS.forEach((forbidden, i) => {
      const importPath = `@/${forbidden.replace(/\/$/, '')}/thing_pb`;
      writeFileSync(
        join(src, `forbidden_${i}.ts`),
        `import { Thing } from '${importPath}';\nexport const t = Thing;\n`,
      );
    });
    // A permitted path.
    writeFileSync(
      join(src, 'permitted.ts'),
      "import { TenantService } from '@/src/gen/gibson/tenant/v1/tenant_pb';\nexport const s = TenantService;\n",
    );
    // A near-miss: `budget_status` is not `budget/v1/`.
    writeFileSync(
      join(src, 'near_miss.ts'),
      "import { Status } from '@/src/gen/gibson/budget_status/v1/status_pb';\nexport const b = Status;\n",
    );
    // A comment that names a forbidden path is not an import.
    writeFileSync(
      join(src, 'comment_only.ts'),
      `// moved from ${FORBIDDEN_GEN_PATHS[0]} to the daemon service\n/**\n * was: ${FORBIDDEN_GEN_PATHS[2]}\n */\nexport const c = 1;\n`,
    );

    const violations = scan([src], dir);

    FORBIDDEN_GEN_PATHS.forEach((forbidden, i) => {
      const hits = violations.filter(
        (v) => v.file === join('src', `forbidden_${i}.ts`) && v.forbidden === forbidden,
      );
      if (hits.length !== 1) {
        failures.push(`an import from ${forbidden} was not caught`);
      }
    });
    for (const name of ['permitted.ts', 'near_miss.ts', 'comment_only.ts']) {
      if (violations.some((v) => v.file === join('src', name))) {
        failures.push(`the compliant fixture ${name} was reported`);
      }
    }
    if (violations.length !== FORBIDDEN_GEN_PATHS.length) {
      failures.push(
        `expected ${FORBIDDEN_GEN_PATHS.length} violations, got ${violations.length}`,
      );
    }

    // The header of this file and the array must list the same paths.
    const own = readFileSync(fileURLToPath(import.meta.url), 'utf-8');
    const header = own.slice(0, own.indexOf('*/'));
    const listed = [...header.matchAll(/^ \*   - (src\/gen\/\S+)$/gm)].map((m) => m[1]);
    for (const forbidden of FORBIDDEN_GEN_PATHS) {
      if (!listed.includes(forbidden)) {
        failures.push(`the header does not list the forbidden path ${forbidden}`);
      }
    }
    for (const path of listed) {
      if (!FORBIDDEN_GEN_PATHS.includes(path)) {
        failures.push(`the header lists ${path}, which the array does not forbid`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    for (const f of failures) {
      process.stderr.write(`check-no-direct-admin-rpc: SELFTEST FAIL: ${f}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(
    `check-no-direct-admin-rpc: SELFTEST OK: an import from each of the ${FORBIDDEN_GEN_PATHS.length} forbidden paths is caught, the compliant fixtures pass, and the header lists the same paths\n`,
  );
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  main();
}
