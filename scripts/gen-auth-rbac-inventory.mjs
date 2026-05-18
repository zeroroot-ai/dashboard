#!/usr/bin/env node
/**
 * Generate enterprise/docs/AUTH_RBAC_INVENTORY.md from the rendered
 * chart + the FGA tuple seed. Single auditable source of truth for the
 * dashboard's RBAC posture.
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

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, '..');
// Worktree-aware: when DASHBOARD_ROOT is .worktrees/<name>/ the naive
// `../../..` walk lands short of the workspace root. Rewind to the main
// checkout root before walking up. dashboard#197 (same pattern as #175).
const isWorktree = DASHBOARD_ROOT.includes('/.worktrees/');
const MAIN_DASHBOARD_ROOT = isWorktree
  ? DASHBOARD_ROOT.replace(/\/\.worktrees\/[^/]+$/, '')
  : DASHBOARD_ROOT;
const REPO_ROOT = resolve(MAIN_DASHBOARD_ROOT, '..', '..', '..');
const CHART_DIR = resolve(REPO_ROOT, 'enterprise/deploy/helm/gibson');
const FGA_INIT = resolve(CHART_DIR, 'templates/openfga/init-job.yaml');
const OUTPUT_PATH = resolve(REPO_ROOT, 'enterprise/docs/AUTH_RBAC_INVENTORY.md');

function renderChart() {
  // Render with values-kind.yaml so the chart's environment-overlay-required
  // values (idp.zitadel.issuer, vault.enabled, etc.) are satisfied. The
  // generated inventory is environment-independent (it lists rule shapes,
  // not concrete values), so any working overlay produces the same output.
  const valuesKind = resolve(CHART_DIR, 'values-kind.yaml');
  return execFileSync(
    'helm',
    [
      'template',
      CHART_DIR,
      '--values',
      valuesKind,
      '--set',
      'tenantOperator.billing.devAutoConfirm=false',
      '--api-versions=monitoring.coreos.com/v1',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
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

function extractDashboardFGATuple() {
  // Look up the seeded tuple inline in the openfga init job script.
  let body = '';
  try {
    body = readFileSync(FGA_INIT, 'utf8');
  } catch {
    return null;
  }
  const m = /platform\/dashboard.+?platform_operator.+?system_tenant:_system/s.exec(body);
  if (!m) return null;
  return {
    user: 'user:<trust-domain>/platform/dashboard',
    relation: 'platform_operator',
    object: 'system_tenant:_system',
    seededBy: 'enterprise/deploy/helm/gibson/templates/openfga/init-job.yaml (post-install/post-upgrade Hook)',
    purpose:
      'Authorizes the dashboard workload SPIFFE identity to call admin RPCs that operate on the system tenant (Shutdown, ImpersonateTenant, UpsertTenantQuota, etc.). User-acting RPCs do NOT use this tuple — those reach FGA as `user:<zitadel-sub>` per spec dashboard-fga-user-identity.',
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

  const tuple = extractDashboardFGATuple();
  const nps = networkPoliciesForDashboard(docs);

  const out = [];
  out.push('# Auth RBAC Inventory — Gibson Dashboard');
  out.push('');
  out.push('> Generated by `enterprise/platform/dashboard/scripts/gen-auth-rbac-inventory.mjs`.');
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
    out.push('_(none — dashboard ingress is gated at the Envoy edge)_');
    out.push('');
  } else {
    for (const np of nps) out.push(renderNetworkPolicy(np));
  }

  return out.join('\n') + '\n';
}

const argv = process.argv.slice(2);
const text = generate();
if (argv.includes('--stdout')) {
  process.stdout.write(text);
} else {
  writeFileSync(OUTPUT_PATH, text, 'utf8');
  console.log(`wrote ${OUTPUT_PATH}`);
}
