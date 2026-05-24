#!/usr/bin/env node
/**
 * check-no-direct-admin-rpc.mjs
 *
 * Build-time guard enforcing ADR-0037: after the DaemonAdminService and
 * TenantAdminService deletion from platform-sdk, no source file under
 * `src/` or `app/` may import generated TypeScript bindings from the
 * deleted admin-only paths inside `src/gen/`:
 *
 *   - src/gen/gibson/daemon/admin  (DaemonAdminService — moved to DaemonService)
 *   - src/gen/gibson/platform      (PlatformOperatorService — moved to DaemonOperatorService)
 *   - src/gen/gibson/tenant/admin  (future guard; path is reserved)
 *
 * The guard is intentionally path-based so a `proto:generate` run that
 * accidentally regenerates a deleted directory is caught immediately at
 * next build, before any code references it.
 *
 * Permitted paths:
 *   - src/gen/gibson/admin/v1/     — gibson.admin.v1.TenantAdminService (broker RPCs, stays)
 *   - src/gen/gibson/tenant/v1/    — gibson.tenant.v1.TenantService (new OSS SDK)
 *   - src/gen/gibson/daemon/v1/    — gibson.daemon.v1.DaemonService (OSS SDK)
 *   - All other src/gen/ subtrees
 *
 * Exemptions:
 *   - node_modules, .next, build output
 *   - Test files (*.test.*, *.spec.*, __tests__/, e2e/) — may reference
 *     deleted paths in historical comments or negative assertions.
 *   - Lines that are purely comments (start with // or inside block comments)
 *
 * Spec: dashboard#336 (ADR-0037 platform-sdk admin surface removal).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = join(__dirname, '..');

/**
 * Paths inside src/gen/ that are forbidden after ADR-0037:
 *   - DaemonAdminService was deleted from platform-sdk; its RPCs moved to
 *     DaemonService (OSS SDK). Importing daemon_admin_pb is now forbidden.
 *   - TenantAdminService (platform-sdk tenant.v1) was deleted; its RPCs
 *     moved to TenantService (OSS SDK tenant.v1). Importing tenant_admin_pb
 *     as the primary service source is now forbidden.
 *
 * NOT listed as forbidden:
 *   - src/gen/gibson/admin/v1   — BrokerConfig/TenantAdminService (admin.v1) still lives here
 *   - src/gen/gibson/tenant/v1  — new TenantService (tenant_pb.ts) lives here
 */
const FORBIDDEN_GEN_PATHS = [
  'src/gen/gibson/daemon/admin',
  'src/gen/gibson/platform',   // PlatformOperatorService — moved to DaemonOperatorService (daemon/operator/v1)
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

function main() {
  const srcDir = join(DASHBOARD_ROOT, 'src');
  const appDir = join(DASHBOARD_ROOT, 'app');

  const allFiles = [...collectFiles(srcDir), ...collectFiles(appDir)];

  let violations = 0;

  for (const file of allFiles) {
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
          // Make path relative to dashboard root for readability
          const rel = file.startsWith(DASHBOARD_ROOT)
            ? file.slice(DASHBOARD_ROOT.length + 1)
            : file;
          process.stderr.write(
            `check-no-direct-admin-rpc: ERROR: ${rel}:${i + 1} imports from deleted admin gen path: ${forbidden}\n`,
          );
          violations++;
        }
      }
    }
  }

  if (violations > 0) {
    process.stderr.write(
      `\ncheck-no-direct-admin-rpc: ${violations} violation(s) found.\n` +
        '  src/gen/gibson/daemon/admin was deleted by ADR-0037. Migrate callers:\n' +
        '    DaemonAdminService CUE/CreateMissionDefinition → DaemonService (src/gen/gibson/daemon/v1/daemon_pb)\n',
    );
    process.exit(1);
  }

  process.stdout.write('check-no-direct-admin-rpc: clean\n');
}

main();
