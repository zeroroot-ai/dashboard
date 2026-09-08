#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Build guard: diff the dashboard ServiceAccount's rendered RBAC
 * against the committed allow-list at
 * `helm/gibson-workloads/.dashboard-rbac-allowlist.yaml` in the charts
 * repository.
 *
 * Spec: auth-resolution-hardening (R1.5)
 *
 * Background
 * ----------
 * The chart's `gibson-dashboard-crd` ClusterRole grants the dashboard
 * SA cluster-wide permissions. A regression that silently re-adds
 * `delete` on tenants (or any other broader-than-needed verb) would
 * expand the blast radius of an SSRF/RCE in the dashboard pod. This
 * guard fails the build the moment a verb appears that isn't in the
 * allow-list.
 *
 * How it works
 * ------------
 * 1. Reads the chart's committed golden render. The charts repository renders
 *    the umbrella with the vanilla overlay and commits the result, so this
 *    guard needs neither helm nor a dependency build, and it reads exactly the
 *    manifests the chart's own gate asserts on.
 * 2. Parses every `ClusterRole` and `Role` whose name matches
 *    `gibson-dashboard*`.
 * 3. For each rule, looks up the matching allow-list entry by
 *    (apiGroups, resources). Fails the build on:
 *      - any rule with no matching allow-list entry, or
 *      - any verb in the rendered rule that isn't in the allow-list's
 *        verbs set.
 *
 * Self-test
 * ---------
 * `--selftest` plants a non-allow-listed verb in the rendered output,
 * asserts the diff catches it, restores. Doesn't actually mutate the
 * chart files.
 *
 * Usage
 * -----
 *   node scripts/check-dashboard-rbac-minimal.mjs
 *   node scripts/check-dashboard-rbac-minimal.mjs --selftest
 *
 * Exit codes: 0 = clean, 1 = violation, 2 = config / tooling error.
 */


import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { resolveRepoPath } from './lib/workspace-root.mjs';

const SCRIPT_NAME = 'check-dashboard-rbac-minimal.mjs';
const SPEC_NAME = 'auth-resolution-hardening';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, '..');
// The resolver takes a repository name and a path inside it, and finds the
// checkout by searching the ancestors of this one. The workloads chart lives in
// the public charts repository (ADR-0086).
const ALLOWLIST_REL = 'helm/gibson-workloads/.dashboard-rbac-allowlist.yaml';
const GOLDEN_REL = 'helm/testdata/golden/values-vanilla.withcaps.yaml';
const chartsFound = resolveRepoPath('charts', ALLOWLIST_REL, {
  from: DASHBOARD_ROOT,
});
const ALLOWLIST_PATH =
  chartsFound?.path ?? resolve(DASHBOARD_ROOT, 'charts', ALLOWLIST_REL);
const GOLDEN_PATH = chartsFound
  ? resolve(chartsFound.repoRoot, GOLDEN_REL)
  : resolve(DASHBOARD_ROOT, 'charts', GOLDEN_REL);

function loadAllowlist() {
  const raw = readFileSync(ALLOWLIST_PATH, 'utf8');
  const doc = yaml.parse(raw);
  if (!doc || !Array.isArray(doc.rules)) {
    throw new Error(`allow-list at ${ALLOWLIST_PATH} missing 'rules' array`);
  }
  return doc.rules.map((r) => ({
    apiGroups: new Set(r.apiGroups ?? []),
    resources: new Set(r.resources ?? []),
    verbs: new Set(r.verbs ?? []),
  }));
}

function renderChart() {
  // The rendered RBAC does not depend on environment values, so the vanilla
  // golden is sufficient for the minimal-RBAC invariant this guard checks.
  return readFileSync(GOLDEN_PATH, 'utf8');
}

function parseDocs(rendered) {
  const docs = [];
  for (const chunk of rendered.split(/\n---\n/)) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    let parsed;
    try {
      parsed = yaml.parse(trimmed);
    } catch {
      continue;
    }
    if (parsed && typeof parsed === 'object') docs.push(parsed);
  }
  return docs;
}

function isDashboardRBAC(doc) {
  if (!doc || typeof doc !== 'object') return false;
  if (doc.kind !== 'ClusterRole' && doc.kind !== 'Role') return false;
  const name = doc.metadata?.name ?? '';
  return name.startsWith('gibson-dashboard');
}

function findAllowlistEntry(allowlist, ruleApiGroups, ruleResources) {
  // Exact match on the (apiGroups, resources) pair. We don't try to
  // partition rules, the allow-list is the canonical shape.
  return allowlist.find((entry) => {
    const apiMatch =
      ruleApiGroups.length === entry.apiGroups.size &&
      ruleApiGroups.every((g) => entry.apiGroups.has(g));
    const resMatch =
      ruleResources.length === entry.resources.size &&
      ruleResources.every((r) => entry.resources.has(r));
    return apiMatch && resMatch;
  });
}

function checkRules(rbacDoc, allowlist) {
  const violations = [];
  const rules = rbacDoc.rules ?? [];
  for (const rule of rules) {
    const apiGroups = rule.apiGroups ?? [''];
    const resources = rule.resources ?? [];
    const verbs = rule.verbs ?? [];
    const entry = findAllowlistEntry(allowlist, apiGroups, resources);
    if (!entry) {
      violations.push({
        kind: 'unknown-rule',
        detail: `${rbacDoc.kind} ${rbacDoc.metadata.name}: rule for apiGroups=[${apiGroups.join(',')}] resources=[${resources.join(',')}] is not in the allow-list`,
      });
      continue;
    }
    for (const v of verbs) {
      if (!entry.verbs.has(v)) {
        violations.push({
          kind: 'extra-verb',
          detail: `${rbacDoc.kind} ${rbacDoc.metadata.name}: verb '${v}' for resources=[${resources.join(',')}] is not in the allow-list`,
        });
      }
    }
  }
  return violations;
}

function run() {
  const allowlist = loadAllowlist();
  const rendered = renderChart();
  const docs = parseDocs(rendered).filter(isDashboardRBAC);

  if (docs.length === 0) {
    console.error(
      `[${SCRIPT_NAME}] FAIL, no gibson-dashboard ClusterRole/Role rendered. Has the chart structure changed?`,
    );
    process.exit(2);
  }

  const all = [];
  for (const d of docs) all.push(...checkRules(d, allowlist));
  return all;
}

function selftest() {
  // We exercise the diff against a synthetic rendered doc rather than
  // mutating chart files on disk.
  const allowlist = loadAllowlist();
  const synthetic = {
    apiVersion: 'rbac.authorization.k8s.io/v1',
    kind: 'ClusterRole',
    metadata: { name: 'gibson-dashboard-crd' },
    rules: [
      {
        apiGroups: ['gibson.zeroroot.ai'],
        resources: ['tenants'],
        verbs: ['get', 'watch', 'delete'], // 'delete' is not in allow-list
      },
    ],
  };
  const violations = checkRules(synthetic, allowlist);
  if (violations.length === 0) {
    console.error(
      `[${SCRIPT_NAME}] SELFTEST FAILED: guard did not catch a planted 'delete' verb on tenants`,
    );
    process.exit(1);
  }
  const found = violations.find((v) => v.kind === 'extra-verb' && /'delete'/.test(v.detail));
  if (!found) {
    console.error(
      `[${SCRIPT_NAME}] SELFTEST FAILED: violation list did not include the planted 'delete' verb`,
    );
    process.exit(1);
  }
  console.log(`[${SCRIPT_NAME}] selftest OK, guard caught the planted 'delete' verb`);
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  selftest();
  process.exit(0);
}

// Skip when no charts checkout is nearby. In dashboard-only CI there is none,
// so there is nothing to render or diff against. The workstation and the full
// multi-repo CI path always have one and run the check end to end.
if (!existsSync(ALLOWLIST_PATH) || !existsSync(GOLDEN_PATH)) {
  process.stderr.write(
    `[${SCRIPT_NAME}] SKIPPED, no charts checkout holds ${ALLOWLIST_REL} and ` +
      `${GOLDEN_REL}; skipping the manifest-RBAC-minimal check.\n`,
  );
  process.exit(0);
}

// Skip on request (e.g. inside the Docker build image, which carries no
// charts checkout). The check is a dev-host gate; the Docker build only needs
// the prebuild code-quality checks that don't require helm.
// Spec: signup-zitadel-permissions-fix (Docker build fix for auth-resolution-hardening).
if (process.env.SKIP_DASHBOARD_RBAC_CHECK === '1') {
  console.log(`[${SCRIPT_NAME}] SKIPPED, SKIP_DASHBOARD_RBAC_CHECK=1`);
  process.exit(0);
}

const violations = run();
if (violations.length > 0) {
  console.error(`\n[${SCRIPT_NAME}] FAIL, ${violations.length} violation(s). Spec: ${SPEC_NAME}`);
  for (const v of violations) console.error(`  ${v.kind}: ${v.detail}`);
  console.error(
    '\nResolve by either: (a) removing the verb from the chart template, OR (b) updating .dashboard-rbac-allowlist.yaml in the same PR with a justification.',
  );
  process.exit(1);
}
console.log(`[${SCRIPT_NAME}] OK, dashboard RBAC matches the allow-list`);
