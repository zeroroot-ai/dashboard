/**
 * Per-Application report derivation (pure).
 *
 * Folds the tenant knowledge graph and the World's LLM-call log into the
 * numbers the report page renders, for ONE Application. Lives under `src/lib/`
 * so every number is unit-testable against a fixture with no network, no
 * daemon and no React.
 *
 * It reads what the existing routes already return (`/api/graph`,
 * `/api/traces`) and opens no new daemon channel, per dashboard#1157.
 *
 * # How a Finding is attached to an Application
 *
 * Taxonomy v2 (gibson#1656) has no Finding -> Application edge, so attachment
 * is by two paths, unioned:
 *
 *  1. **Scope.** A Finding and an Application both carry `scope`, the boundary
 *     the daemon resolves server-side from the mission's target definition. It
 *     is never emitter-supplied, which is what makes it trustworthy as a join
 *     key. This is the path that reaches image and source findings, which have
 *     no edge to anything the Application owns.
 *  2. **Reachability.** Finding -AFFECTS-> Host <-EXPOSES- Deployment
 *     <-HAS_DEPLOYMENT- Application. This is the path that reaches runtime
 *     findings when their scope differs from the Application's.
 *
 * The scope path is one-Application-per-scope by construction. A tenant that
 * puts two Applications in one scope would see the other's findings here; that
 * is a Taxonomy limitation (there is no owning edge to disambiguate), recorded
 * on the issue rather than papered over with a guess.
 */

import type { GraphNode, GraphEdge } from '@/src/types/graph';
import type { LlmCallSummary } from '@/src/types/trace';
import { parseEntityType } from '@/src/lib/graph/entity-taxonomy';
import { estimateCallCostUsd } from '@/src/lib/world-traces';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Finding severities, most to least severe. */
export const REPORT_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type ReportSeverity = (typeof REPORT_SEVERITIES)[number];

/**
 * Finding statuses, in fix order (gibson `internal/engine/brain/attention.go`).
 * Status lives on the Finding and only there; a Vulnerability never carries
 * one. A Finding reaches `verified` only by a rescan, never by a merge.
 */
export const FINDING_STATUSES = ['open', 'fixing', 'fixed', 'verified'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

// ---------------------------------------------------------------------------
// Report shape
// ---------------------------------------------------------------------------

/** A measure the graph cannot answer yet, and precisely why. */
export interface Unmeasurable {
  measurable: false;
  /** Plain-words reason, rendered to the operator. No blame, just the gap. */
  reason: string;
}

export interface VulnerabilitySummary {
  /** The shared identity: a CVE, GHSA, CWE or platform id. */
  key: string;
  /** Findings on THIS Application that instance this Vulnerability. */
  findingsHere: number;
  /** Findings anywhere in the tenant that instance it (the fan-in). */
  findingsTenantWide: number;
  /** Highest severity among this Application's findings for it. */
  topSeverity: ReportSeverity | null;
}

export interface MergeRequestSummary {
  key: string;
  title: string;
  /** Outbound link to the git host, when the node carries one. */
  url: string | null;
  /** Free-form state from the node (`opened`, `merged`, ...). */
  state: string | null;
  /** Findings on this Application that this merge request fixes. */
  fixesFindings: number;
}

export interface ReportCost {
  estimatedCostUsd: number;
  llmCallCount: number;
  /**
   * How the cost was attributed. `scope` means the calls carry this
   * Application's scope. `none` means the Application has no scope to join on,
   * so no cost is claimed rather than a tenant-wide total being passed off as
   * this Application's.
   */
  attributedBy: 'scope' | 'none';
}

export interface ApplicationReport {
  application: { key: string; name: string; scope: string } | null;
  findingCount: number;
  bySeverity: Record<ReportSeverity, number>;
  /** Findings whose severity is absent or unrecognised. Never bucketed into `info`. */
  unknownSeverity: number;
  byStatus: Record<FindingStatus, number>;
  /** Findings with no status yet (projected before Taxonomy v2). */
  unknownStatus: number;
  vulnerabilities: VulnerabilitySummary[];
  mergeRequests: MergeRequestSummary[];
  cost: ReportCost;
  /**
   * Both time-based measures. Typed as unmeasurable ONLY, because the graph
   * cannot answer them today (see NO_FINDING_TIMESTAMPS) and a union with a
   * branch nothing can produce would be a dead path. When the daemon records
   * the two instants, this type widens and the page gains its number in that
   * same change.
   */
  timeToVerified: Unmeasurable;
  timeline: Unmeasurable;
}

export interface ReportInput {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Flat LLM calls (a run's `calls`), used for cost attribution. */
  calls: LlmCallSummary[];
  /** The Application node's `key` property. */
  applicationKey: string;
}

// ---------------------------------------------------------------------------
// Why two measures are not derivable today
// ---------------------------------------------------------------------------

/**
 * The graph records a Finding's CURRENT status and a single `updated_at` that
 * is re-stamped on every projection pass. It keeps no `created_at` on a
 * Finding and no history of status transitions, so neither the moment a
 * Finding opened nor the moment it was verified survives a later rescan.
 *
 * Both time-based measures on this page depend on those two instants, so both
 * report themselves unmeasurable rather than presenting a number derived from
 * `updated_at`, which would silently mean "time since the last scan touched
 * it" and would shrink every time a scan ran.
 *
 * Tracked in gibson#1671.
 */
export const NO_FINDING_TIMESTAMPS =
  'The graph keeps a Finding’s current status but not when it opened or when it ' +
  'was verified, so this cannot be measured yet. It appears here as soon as the ' +
  'daemon records those two instants.';

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

function prop(node: GraphNode, name: string): string {
  const v = node.properties?.[name];
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function isType(node: GraphNode, type: string): boolean {
  return parseEntityType(node.labels) === type;
}

function severityOf(node: GraphNode): ReportSeverity | null {
  const raw = prop(node, 'severity').toLowerCase();
  return (REPORT_SEVERITIES as readonly string[]).includes(raw)
    ? (raw as ReportSeverity)
    : null;
}

function statusOf(node: GraphNode): FindingStatus | null {
  const raw = prop(node, 'status').toLowerCase();
  return (FINDING_STATUSES as readonly string[]).includes(raw)
    ? (raw as FindingStatus)
    : null;
}

/** Rank for "highest severity wins", critical highest. */
const SEVERITY_RANK: Record<ReportSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/**
 * Derive one Application's report. Pure: same input, same output. Returns a
 * report with a null `application` when the key matches nothing, so the page
 * can tell "no such Application" from "an Application with no findings".
 */
export function deriveApplicationReport(input: ReportInput): ApplicationReport {
  const { nodes, edges, calls, applicationKey } = input;

  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const app =
    nodes.find((n) => isType(n, 'application') && prop(n, 'key') === applicationKey) ?? null;

  const empty: ApplicationReport = {
    application: null,
    findingCount: 0,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    unknownSeverity: 0,
    byStatus: { open: 0, fixing: 0, fixed: 0, verified: 0 },
    unknownStatus: 0,
    vulnerabilities: [],
    mergeRequests: [],
    cost: { estimatedCostUsd: 0, llmCallCount: 0, attributedBy: 'none' },
    timeToVerified: { measurable: false, reason: NO_FINDING_TIMESTAMPS },
    timeline: { measurable: false, reason: NO_FINDING_TIMESTAMPS },
  };
  if (!app) return empty;

  const scope = prop(app, 'scope');

  // Path 2: Application -HAS_DEPLOYMENT-> Deployment -EXPOSES-> Host.
  const deployments = new Set(
    edges.filter((e) => e.type === 'HAS_DEPLOYMENT' && e.source === app.id).map((e) => e.target),
  );
  const exposedHosts = new Set(
    edges.filter((e) => e.type === 'EXPOSES' && deployments.has(e.source)).map((e) => e.target),
  );
  const findingsAffectingExposedHosts = new Set(
    edges
      .filter((e) => e.type === 'AFFECTS' && exposedHosts.has(e.target))
      .map((e) => e.source),
  );

  // Path 1 union path 2.
  const findings = nodes.filter((n) => {
    if (!isType(n, 'finding')) return false;
    if (scope !== '' && prop(n, 'scope') === scope) return true;
    return findingsAffectingExposedHosts.has(n.id);
  });
  const findingIds = new Set(findings.map((f) => f.id));

  // Counts.
  const bySeverity: Record<ReportSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };
  const byStatus: Record<FindingStatus, number> = { open: 0, fixing: 0, fixed: 0, verified: 0 };
  let unknownSeverity = 0;
  let unknownStatus = 0;
  for (const f of findings) {
    const sev = severityOf(f);
    if (sev) bySeverity[sev] += 1;
    else unknownSeverity += 1;
    const st = statusOf(f);
    if (st) byStatus[st] += 1;
    else unknownStatus += 1;
  }

  // Vulnerabilities: one node per identity, with the tenant-wide fan-in that
  // makes the shared-knowledge picture (one CVE, many Findings).
  const instanceOf = edges.filter((e) => e.type === 'INSTANCE_OF');
  const fanInTenantWide = new Map<string, number>();
  for (const e of instanceOf) {
    fanInTenantWide.set(e.target, (fanInTenantWide.get(e.target) ?? 0) + 1);
  }
  const vulnAgg = new Map<string, { here: number; top: ReportSeverity | null }>();
  for (const e of instanceOf) {
    if (!findingIds.has(e.source)) continue;
    const target = byId.get(e.target);
    if (!target) continue;
    const key = prop(target, 'key') || target.id;
    const finding = byId.get(e.source);
    const sev = finding ? severityOf(finding) : null;
    const cur = vulnAgg.get(key) ?? { here: 0, top: null };
    cur.here += 1;
    if (sev && (cur.top === null || SEVERITY_RANK[sev] > SEVERITY_RANK[cur.top])) cur.top = sev;
    vulnAgg.set(key, cur);
    // Carry the fan-in across under the resolved key.
    const raw = fanInTenantWide.get(e.target) ?? 0;
    fanInTenantWide.set(key, Math.max(fanInTenantWide.get(key) ?? 0, raw));
  }
  const vulnerabilities: VulnerabilitySummary[] = [...vulnAgg.entries()]
    .map(([key, v]) => ({
      key,
      findingsHere: v.here,
      findingsTenantWide: fanInTenantWide.get(key) ?? v.here,
      topSeverity: v.top,
    }))
    .sort(
      (a, b) =>
        (b.topSeverity ? SEVERITY_RANK[b.topSeverity] : -1) -
          (a.topSeverity ? SEVERITY_RANK[a.topSeverity] : -1) ||
        b.findingsTenantWide - a.findingsTenantWide ||
        a.key.localeCompare(b.key),
    );

  // Merge requests that fix this Application's findings.
  const mrAgg = new Map<string, { node: GraphNode; fixes: number }>();
  for (const e of edges) {
    if (e.type !== 'FIXED_BY' || !findingIds.has(e.source)) continue;
    const mr = byId.get(e.target);
    if (!mr) continue;
    const key = prop(mr, 'key') || mr.id;
    const cur = mrAgg.get(key) ?? { node: mr, fixes: 0 };
    cur.fixes += 1;
    mrAgg.set(key, cur);
  }
  const mergeRequests: MergeRequestSummary[] = [...mrAgg.entries()]
    .map(([key, { node, fixes }]) => ({
      key,
      title: prop(node, 'title') || key,
      url: prop(node, 'url') || prop(node, 'web_url') || null,
      state: prop(node, 'state') || null,
      fixesFindings: fixes,
    }))
    .sort((a, b) => b.fixesFindings - a.fixesFindings || a.key.localeCompare(b.key));

  // Cost, attributed by scope. With no scope there is nothing honest to claim.
  let estimatedCostUsd = 0;
  let llmCallCount = 0;
  if (scope !== '') {
    for (const c of calls) {
      if (c.scopeId !== scope) continue;
      llmCallCount += 1;
      estimatedCostUsd += estimateCallCostUsd(c.model, c.promptTokens, c.completionTokens);
    }
  }

  return {
    application: { key: applicationKey, name: prop(app, 'name') || applicationKey, scope },
    findingCount: findings.length,
    bySeverity,
    unknownSeverity,
    byStatus,
    unknownStatus,
    vulnerabilities,
    mergeRequests,
    cost: {
      estimatedCostUsd,
      llmCallCount,
      attributedBy: scope === '' ? 'none' : 'scope',
    },
    // Both time measures need instants the graph does not keep. See
    // NO_FINDING_TIMESTAMPS.
    timeToVerified: { measurable: false, reason: NO_FINDING_TIMESTAMPS },
    timeline: { measurable: false, reason: NO_FINDING_TIMESTAMPS },
  };
}
