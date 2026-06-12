#!/usr/bin/env node
/**
 * check-no-k8s-in-grant-action.mjs
 *
 * Build-time guard enforcing that the catalog-enablement grant server actions
 * (app/actions/crd/grant.ts) do NOT import from the K8s client layer
 * (src/lib/k8s/*). Catalog enablement must route through the daemon via
 * MembershipService.SetCatalogEnabled (ADR-0041 remaining gap).
 *
 * This guard catches a reintroduction of the direct ComponentGrant CRD write
 * that was replaced by the daemon RPC in gibson#577.
 *
 * ## What is checked
 *
 * `app/actions/crd/grant.ts` must not import from any path that matches
 * `src/lib/k8s/`. This catches both `@/src/lib/k8s/*` and relative
 * `../../lib/k8s/*` variants.
 *
 * ## Self-test
 *
 * Pass `--selftest` to synthesise a fixture with a banned import, run the
 * scanner, assert it is caught, then clean up. Exits 0 on pass, 1 on fail.
 *
 * ## Usage
 *
 *   node scripts/check-no-k8s-in-grant-action.mjs            # FAIL on violation
 *   node scripts/check-no-k8s-in-grant-action.mjs --selftest # assert detection
 *
 * Wired into `pnpm prebuild` as a hard-fail guard (closes gibson#577 /
 * ADR-0041 catalog-enablement remaining gap).
 */

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_NAME = 'check-no-k8s-in-grant-action.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** File to scan. Relative to repo root. */
const GRANT_ACTION_FILE = join(ROOT, 'app', 'actions', 'crd', 'grant.ts');

/**
 * Patterns that indicate a K8s import in grant.ts.
 * Matches both aliased (@/src/lib/k8s) and relative (../../lib/k8s) forms.
 */
const K8S_IMPORT_PATTERNS = [
  /from\s+['"]@\/src\/lib\/k8s\//,
  /from\s+['"][^'"]*\/lib\/k8s\//,
  /from\s+['"]@\/src\/lib\/k8s['"]/,
];

function scanGrantFile(filePath) {
  let src;
  try {
    src = readFileSync(filePath, 'utf8');
  } catch {
    // If the file doesn't exist, nothing to check.
    return [];
  }

  const violations = [];
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trimStart();
    // Skip comment lines.
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue;

    for (const pattern of K8S_IMPORT_PATTERNS) {
      if (pattern.test(raw)) {
        violations.push({ line: i + 1, text: raw.trim() });
        break;
      }
    }
  }
  return violations;
}

function runSelftest() {
  // Synthesise a fixture with a banned import.
  const fixture = [
    "'use server';",
    "// The following import should be caught:",
    "import { applyComponentGrant } from '@/src/lib/k8s/tenants';",
    "export async function grantComponentAction() {}",
  ].join('\n');

  const fixturePath = join(ROOT, 'app', 'actions', 'crd', '__check_no_k8s_grant_selftest.ts');
  writeFileSync(fixturePath, fixture + '\n');

  let violations = [];
  try {
    violations = scanGrantFile(fixturePath);
  } finally {
    try { unlinkSync(fixturePath); } catch { /* best-effort */ }
  }

  if (violations.length === 0) {
    console.error(`[${SCRIPT_NAME}] SELFTEST FAILED: banned K8s import not caught`);
    return 1;
  }

  console.log(`[${SCRIPT_NAME}] --selftest OK: banned K8s import caught in fixture (${violations.length} violation(s))`);
  return 0;
}

function runScan() {
  const violations = scanGrantFile(GRANT_ACTION_FILE);
  if (violations.length === 0) {
    console.log(
      `[${SCRIPT_NAME}] OK: grant.ts does not import from src/lib/k8s/ ` +
        `(catalog-enablement routes through MembershipService.SetCatalogEnabled as required by ADR-0041)`,
    );
    return 0;
  }

  console.error(`\n[${SCRIPT_NAME}] FAIL, grant.ts imports from src/lib/k8s/ (${violations.length} violation(s)).`);
  console.error('Catalog-enablement must route through the daemon via MembershipService.SetCatalogEnabled.');
  console.error('Replace the K8s client call with userClient(MembershipService).setCatalogEnabled({...}).\n');
  console.error(`  ${GRANT_ACTION_FILE}`);
  for (const v of violations) {
    console.error(`    L${v.line}: ${v.text}`);
    console.error(`      → direct K8s import detected in grant.ts; use daemon RPC instead`);
  }
  console.error(`\n[${SCRIPT_NAME}] Total violations: ${violations.length} (exit 1, HARD FAIL)`);
  return 1;
}

const mode = process.argv[2];
if (mode === '--selftest') {
  process.exit(runSelftest());
} else {
  process.exit(runScan());
}
