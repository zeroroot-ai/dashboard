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
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'yaml';
import { resolveRepoPath } from './lib/workspace-root.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_ROOT = resolve(__dirname, '..');
// The resolver takes a repository name and a path inside it, and finds the
// checkout by searching the ancestors of this one. The umbrella chart lives in
// the public charts repository (ADR-0086).
// The charts repository commits a golden render of the umbrella with the
// baseline values. Reading it needs neither helm nor a dependency build, and it
// is the same artifact the chart's own gate asserts on. The rendered RBAC does
// not depend on environment values, so the baseline golden is enough.
const GOLDEN_REL = 'helm/testdata/golden/values-baseline.withcaps.yaml';
const GOLDEN_PATH =
  resolveRepoPath('charts', GOLDEN_REL, { from: DASHBOARD_ROOT })?.path ??
  resolve(DASHBOARD_ROOT, 'charts', GOLDEN_REL);
const OUTPUT_PATH = resolve(DASHBOARD_ROOT, 'docs/AUTH_RBAC_INVENTORY.md');

function renderChart() {
  return readFileSync(GOLDEN_PATH, 'utf8');
}

export function parseDocs(rendered) {
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

const POLICY_KINDS = new Set([
  'NetworkPolicy',
  'CiliumNetworkPolicy',
  'CiliumClusterwideNetworkPolicy',
]);

/**
 * The pod labels and namespace of the dashboard Deployment. A network policy
 * selects pods by these labels, so they decide which policies gate the pod.
 */
export function dashboardPod(docs) {
  const dep = docs.find(
    (d) => d.kind === 'Deployment' && d.metadata?.name === 'gibson-dashboard',
  );
  if (!dep) return null;
  return {
    namespace: dep.metadata.namespace ?? '',
    labels: dep.spec?.template?.metadata?.labels ?? {},
  };
}

/**
 * A Cilium selector key can carry a source prefix (`k8s:` or `any:`). The pod
 * label has none, so the prefix is dropped before the compare.
 */
function labelKey(key) {
  return key.replace(/^(k8s|any):/, '');
}

/** True when a Kubernetes label selector selects a pod with these labels. */
export function selectorMatches(selector, labels) {
  if (!selector) return false;
  for (const [k, v] of Object.entries(selector.matchLabels ?? {})) {
    if (labels[labelKey(k)] !== String(v)) return false;
  }
  for (const e of selector.matchExpressions ?? []) {
    const key = labelKey(e.key);
    const has = Object.hasOwn(labels, key);
    const values = (e.values ?? []).map(String);
    switch (e.operator) {
      case 'In':
        if (!has || !values.includes(labels[key])) return false;
        break;
      case 'NotIn':
        if (has && values.includes(labels[key])) return false;
        break;
      case 'Exists':
        if (!has) return false;
        break;
      case 'DoesNotExist':
        if (has) return false;
        break;
      default:
        // An operator this reader does not know cannot prove a match.
        return false;
    }
  }
  return true;
}

/** The rule sets of a policy: a Cilium policy holds `spec`, `specs` or both. */
function policySpecs(d) {
  const out = [];
  if (d.spec) out.push(d.spec);
  for (const sp of d.specs ?? []) out.push(sp);
  return out;
}

/**
 * The network policy rule sets that select the dashboard pod: a NetworkPolicy
 * by its podSelector, a Cilium rule set by its endpointSelector. A namespaced
 * policy gates the pod only in the pod's namespace. Cilium gives each pod the
 * label `io.kubernetes.pod.namespace`, so a clusterwide policy can select by
 * it. Each entry is { kind, name, spec }.
 */
export function networkPoliciesForDashboard(docs) {
  const pod = dashboardPod(docs);
  if (!pod) return [];
  const withNamespace = { ...pod.labels, 'io.kubernetes.pod.namespace': pod.namespace };
  const out = [];
  for (const d of docs) {
    if (!POLICY_KINDS.has(d.kind)) continue;
    const clusterwide = d.kind === 'CiliumClusterwideNetworkPolicy';
    if (!clusterwide && (d.metadata?.namespace ?? pod.namespace) !== pod.namespace) continue;
    for (const spec of policySpecs(d)) {
      const sel = d.kind === 'NetworkPolicy' ? spec.podSelector : spec.endpointSelector;
      if (selectorMatches(sel, clusterwide ? withNamespace : pod.labels)) {
        out.push({ kind: d.kind, name: d.metadata.name, spec });
      }
    }
  }
  return out.sort((x, y) => `${x.kind}/${x.name}`.localeCompare(`${y.kind}/${y.name}`));
}

function renderNetworkPolicy({ kind, name, spec }) {
  const sel = (kind === 'NetworkPolicy' ? spec.podSelector : spec.endpointSelector) ?? {};
  const lines = [`### ${kind}: \`${name}\``];
  if (spec.description) lines.push(`- description: ${spec.description}`);
  lines.push(`- selector: \`${JSON.stringify(sel)}\``);
  lines.push(`- ingress rules: ${(spec.ingress ?? []).length}`);
  lines.push(`- egress rules: ${(spec.egress ?? []).length}`);
  if (kind !== 'NetworkPolicy') {
    lines.push(`- ingressDeny rules: ${(spec.ingressDeny ?? []).length}`);
    lines.push(`- egressDeny rules: ${(spec.egressDeny ?? []).length}`);
  }
  lines.push('');
  return lines.join('\n');
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

  out.push('## 3. Network policies that select the dashboard pod');
  out.push('');
  if (nps.length === 0) {
    out.push('_(no network policy selects the dashboard pod)_');
    out.push('');
  } else {
    for (const np of nps) out.push(renderNetworkPolicy(np));
  }

  return out.join('\n') + '\n';
}

// Run only as a script. The unit test imports the pure functions above.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

function main() {
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
}
