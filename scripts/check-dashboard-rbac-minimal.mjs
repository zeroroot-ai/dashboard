#!/usr/bin/env node
/**
 * Build guard: diff the dashboard ServiceAccount's rendered RBAC
 * against the committed allow-list at
 * `enterprise/deploy/helm/gibson/.dashboard-rbac-allowlist.yaml`.
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
 * 1. Renders the chart with default values via `helm template`.
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

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const SCRIPT_NAME = 'check-dashboard-rbac-minimal.mjs';
const SPEC_NAME = 'auth-resolution-hardening';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const CHART_DIR = resolve(REPO_ROOT, 'enterprise/deploy/helm/gibson');
const ALLOWLIST_PATH = resolve(CHART_DIR, '.dashboard-rbac-allowlist.yaml');

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
  // Same flags the e2e suite uses to render past the tenantOperator
  // billing dev-autoconfirm template guard.
  const out = execFileSync(
    'helm',
    [
      'template',
      CHART_DIR,
      '--set',
      'tenantOperator.billing.devAutoConfirm=false',
      '--api-versions=monitoring.coreos.com/v1',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return out;
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
  // partition rules — the allow-list is the canonical shape.
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
      `[${SCRIPT_NAME}] FAIL — no gibson-dashboard ClusterRole/Role rendered. Has the chart structure changed?`,
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
        apiGroups: ['gibson.gibson.io'],
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
  console.log(`[${SCRIPT_NAME}] selftest OK — guard caught the planted 'delete' verb`);
}

const argv = process.argv.slice(2);
if (argv.includes('--selftest')) {
  selftest();
  process.exit(0);
}

const violations = run();
if (violations.length > 0) {
  console.error(`\n[${SCRIPT_NAME}] FAIL — ${violations.length} violation(s). Spec: ${SPEC_NAME}`);
  for (const v of violations) console.error(`  ${v.kind}: ${v.detail}`);
  console.error(
    '\nResolve by either: (a) removing the verb from the chart template, OR (b) updating .dashboard-rbac-allowlist.yaml in the same PR with a justification.',
  );
  process.exit(1);
}
console.log(`[${SCRIPT_NAME}] OK — dashboard RBAC matches the allow-list`);
