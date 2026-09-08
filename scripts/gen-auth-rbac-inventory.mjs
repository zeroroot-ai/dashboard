#!/usr/bin/env node
// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Generate docs/AUTH_RBAC_INVENTORY.md from the rendered chart + the FGA
 * tuple seed. Single auditable source of truth for the dashboard's RBAC
 * posture. The chart comes from a charts checkout; the inventory is committed
 * in this repository, next to the code whose posture it records.
 *
 * Spec: auth-resolution-hardening (R9).
 *
 * Usage
 * -----
 *   node scripts/gen-auth-rbac-inventory.mjs            # writes the doc
 *   node scripts/gen-auth-rbac-inventory.mjs --stdout   # prints to stdout (for the freshness guard)
 *
 * Determinism
 * -----------
 * Uses fixed sort orders (apiGroup ASC, resource ASC, verb ASC). The
 * freshness guard (check-auth-rbac-inventory-fresh.mjs) regenerates
 * with --stdout and diffs against the committed file; the script must
 * produce byte-identical output for the same chart input.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';
import { resolveRepoPath } from './lib/workspace-root.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, '..');
// The resolver takes a repository name and a path inside it, and finds the
// checkout by searching the ancestors of this one. The umbrella chart lives in
// the public charts repository (ADR-0086).
// The charts repository commits a golden render of the umbrella with the
// vanilla overlay. Reading it needs neither helm nor a dependency build, and it
// is the same artifact the chart's own gate asserts on. The rendered RBAC does
// not depend on environment values, so the vanilla golden is enough.
const GOLDEN_REL = 'helm/testdata/golden/values-vanilla.withcaps.yaml';
const GOLDEN_PATH =
  resolveRepoPath('charts', GOLDEN_REL, { from: DASHBOARD_ROOT })?.path ??
  resolve(DASHBOARD_ROOT, 'charts', GOLDEN_REL);
const OUTPUT_PATH = resolve(DASHBOARD_ROOT, 'docs/AUTH_RBAC_INVENTORY.md');

function renderChart() {
  return readFileSync(GOLDEN_PATH, 'utf8');
}

function parseDocs(rendered) {
  const docs = [];
  for (const chunk of rendered.split(/\n---\n/)) {
    const t = chunk.trim();
    if (!t) continue;
    try {
      const d = yaml.parse(t);
      if (d && typeof d === 'object') docs.push(d);
    } catch {
      // skip
    }
  }
  return docs;
}

function isDashboardSubject(subject) {
  return (
    subject?.kind === 'ServiceAccount' &&
    typeof subject.name === 'string' &&
    subject.name.startsWith('gibson-dashboard')
  );
}

/** Names of RBAC docs that bind any role to the dashboard SA. */
function bindingsToDashboardSA(docs) {
  const target = new Set();
  for (const d of docs) {
    if (d.kind !== 'ClusterRoleBinding' && d.kind !== 'RoleBinding') continue;
    const subjects = d.subjects ?? [];
    if (subjects.some(isDashboardSubject)) {
      target.add(`${d.roleRef.kind}::${d.roleRef.name}`);
    }
  }
  return target;
}

function rolesByName(docs) {
  const m = new Map();
  for (const d of docs) {
    if (d.kind !== 'ClusterRole' && d.kind !== 'Role') continue;
    m.set(`${d.kind}::${d.metadata.name}`, d);
  }
  return m;
}

function sortRules(rules) {
  return rules
    .map((r) => ({
      apiGroups: [...(r.apiGroups ?? [''])].sort(),
      resources: [...(r.resources ?? [])].sort(),
      verbs: [...(r.verbs ?? [])].sort(),
    }))
    .sort((a, b) => {
      const ag = a.apiGroups.join(',');
      const bg = b.apiGroups.join(',');
      if (ag !== bg) return ag < bg ? -1 : 1;
      const ar = a.resources.join(',');
      const br = b.resources.join(',');
      if (ar !== br) return ar < br ? -1 : 1;
      return 0;
    });
}

function verbsExplain(verbs) {
  const map = {
    get: 'read one by name',
    list: 'enumerate all (cluster-wide if ClusterRole)',
    watch: 'subscribe to changes',
    create: 'write new objects',
    update: 'replace existing objects',
    patch: 'modify fields on existing objects',
    delete: 'remove objects',
    deletecollection: 'remove many objects matching a selector',
  };
  return verbs.map((v) => `\`${v}\` (${map[v] ?? 'verb'})`).join(', ');
}

function renderRoleTable(role) {
  const lines = [];
  lines.push(`### ${role.kind}: \`${role.metadata.name}\``);
  if (role.metadata.namespace) lines.push(`- Namespace: \`${role.metadata.namespace}\``);
  lines.push('');
  lines.push('| apiGroup | Resources | Verbs |');
  lines.push('| --- | --- | --- |');
  for (const r of sortRules(role.rules ?? [])) {
    const apiG = r.apiGroups.map((g) => (g === '' ? '`""` (core)' : `\`${g}\``)).join(', ');
    const res = r.resources.map((s) => `\`${s}\``).join(', ');
    lines.push(`| ${apiG} | ${res} | ${verbsExplain(r.verbs)} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function extractDashboardFGATuple(rendered) {
  // The seeded tuple is inline in the rendered FGA init job.
  const body = rendered;
  const m = /platform\/dashboard.+?platform_operator.+?system_tenant:_system/s.exec(body);
  if (!m) return null;
  return {
    user: 'user:<trust-domain>/platform/dashboard',
    relation: 'platform_operator',
    object: 'system_tenant:_system',
    seededBy: 'charts: helm/gibson-workloads/templates/fga-init/job.yaml (post-install/post-upgrade Hook)',
    purpose:
      'Authorizes the dashboard workload SPIFFE identity to call admin RPCs that operate on the system tenant (Shutdown, ImpersonateTenant, UpsertTenantQuota, etc.). User-acting RPCs do NOT use this tuple, those reach FGA as `user:<zitadel-sub>` per spec dashboard-fga-user-identity.',
  };
}

function networkPoliciesForDashboard(docs) {
  return docs
    .filter((d) => d.kind === 'NetworkPolicy')
    .filter((d) => {
      const ml = d.spec?.podSelector?.matchLabels ?? {};
      const labels = JSON.stringify(ml);
      return /gibson-dashboard|dashboard/i.test(labels);
    });
}

function renderNetworkPolicy(np) {
  const sel = np.spec?.podSelector?.matchLabels ?? {};
  const ingress = np.spec?.ingress ?? [];
  const egress = np.spec?.egress ?? [];
  return [
    `### NetworkPolicy: \`${np.metadata.name}\``,
    `- podSelector.matchLabels: \`${JSON.stringify(sel)}\``,
    `- ingress rules: ${ingress.length}`,
    `- egress rules: ${egress.length}`,
    '',
  ].join('\n');
}

function generate() {
  const rendered = renderChart();
  const docs = parseDocs(rendered);
  const bound = bindingsToDashboardSA(docs);
  const roles = rolesByName(docs);
  const dashboardRoles = [...bound]
    .filter((k) => roles.has(k))
    .map((k) => roles.get(k))
    .sort((a, b) => a.metadata.name.localeCompare(b.metadata.name));

  const tuple = extractDashboardFGATuple(rendered);
  const nps = networkPoliciesForDashboard(docs);

  const out = [];
  out.push('# Auth RBAC Inventory, Gibson Dashboard');
  out.push('');
  out.push('> Generated by `scripts/gen-auth-rbac-inventory.mjs` in zeroroot-ai/dashboard.');
  out.push('> Do NOT hand-edit. Regenerate with `npm run gen:auth-rbac-inventory`.');
  out.push('> Freshness is enforced by `scripts/check-auth-rbac-inventory-fresh.mjs` in `npm run prebuild`.');
  out.push('');
  out.push('Spec: `auth-resolution-hardening` (Req 9).');
  out.push('');
  out.push('---');
  out.push('');

  out.push('## 1. Kubernetes RBAC bound to the gibson-dashboard ServiceAccount');
  out.push('');
  if (dashboardRoles.length === 0) {
    out.push('_(none rendered)_');
    out.push('');
  } else {
    for (const role of dashboardRoles) out.push(renderRoleTable(role));
  }

  out.push('## 2. FGA tuples seeded for the dashboard workload identity');
  out.push('');
  if (!tuple) {
    out.push('_(no seeded tuple detected)_');
    out.push('');
  } else {
    out.push(`- **User**: \`${tuple.user}\``);
    out.push(`- **Relation**: \`${tuple.relation}\``);
    out.push(`- **Object**: \`${tuple.object}\``);
    out.push(`- **Seeded by**: ${tuple.seededBy}`);
    out.push('');
    out.push(`> ${tuple.purpose}`);
    out.push('');
  }

  out.push('## 3. NetworkPolicies that gate dashboard ingress/egress');
  out.push('');
  if (nps.length === 0) {
    out.push('_(none, dashboard ingress is gated at the Envoy edge)_');
    out.push('');
  } else {
    for (const np of nps) out.push(renderNetworkPolicy(np));
  }

  return out.join('\n') + '\n';
}

const argv = process.argv.slice(2);

// --probe: report whether the chart's golden render is reachable, as JSON on
// stdout. check-auth-rbac-inventory-fresh.mjs uses this to choose between a
// full byte-diff and a structural pass, so the generator that owns this path is
// the only thing that has to know it. Same contract as
// `proto-generate.mjs --probe`.
if (argv.includes('--probe')) {
  const present = existsSync(GOLDEN_PATH);
  process.stdout.write(
    JSON.stringify(
      { sources: { golden: present ? GOLDEN_PATH : null }, available: present },
      null,
      2,
    ) + '\n',
  );
  process.exit(0);
}

const text = generate();
if (argv.includes('--stdout')) {
  process.stdout.write(text);
} else {
  writeFileSync(OUTPUT_PATH, text, 'utf8');
  console.log(`wrote ${OUTPUT_PATH}`);
}
