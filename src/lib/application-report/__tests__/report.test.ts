import { describe, it, expect } from 'vitest';
import {
  deriveApplicationReport,
  NO_FINDING_TIMESTAMPS,
  type ReportInput,
} from '../report';
import type { GraphNode, GraphEdge } from '@/src/types/graph';
import type { LlmCallSummary } from '@/src/types/trace';

// ---------------------------------------------------------------------------
// Fixture
//
// Two Applications so the shared-Vulnerability fan-in is real rather than
// asserted against a single-app graph:
//
//   customer-portal (scope-cp)          treasury-api (scope-tr)
//     |- Deployment -> Host h1            |- f5 (CVE-2025-1111, open)
//     |- f1 critical open      (scope)
//     |- f2 high     fixing    (scope)  -> MR !42
//     |- f3 medium   fixed     (scope)  -> MR !42
//     |- f4 low      verified  (reachability only, different scope)
//     |- f6 no severity, no status      (pre-v2 projection)
//
//   f1 and f5 both INSTANCE_OF CVE-2025-1111 -> fan-in 2, one of them here.
// ---------------------------------------------------------------------------

function node(
  id: string,
  label: string,
  properties: Record<string, unknown> = {},
): GraphNode {
  return { id, labels: [label], properties };
}

const nodes: GraphNode[] = [
  node('app-cp', 'Application', { key: 'customer-portal', name: 'Customer Portal', scope: 'scope-cp' }),
  node('app-tr', 'Application', { key: 'treasury-api', name: 'Treasury API', scope: 'scope-tr' }),

  node('dep-cp', 'Deployment', { key: 'examplebank/customer-portal@staging', scope: 'scope-cp' }),
  node('h1', 'Host', { address: '10.0.0.7', scope: 'scope-other' }),

  node('f1', 'Finding', { severity: 'critical', status: 'open', scope: 'scope-cp' }),
  node('f2', 'Finding', { severity: 'high', status: 'fixing', scope: 'scope-cp' }),
  node('f3', 'Finding', { severity: 'medium', status: 'fixed', scope: 'scope-cp' }),
  // Reached only through AFFECTS -> Host <- EXPOSES <- Deployment.
  node('f4', 'Finding', { severity: 'low', status: 'verified', scope: 'scope-other' }),
  node('f5', 'Finding', { severity: 'critical', status: 'open', scope: 'scope-tr' }),
  // Projected before Taxonomy v2: no severity, no status.
  node('f6', 'Finding', { scope: 'scope-cp' }),

  node('v-1111', 'Vulnerability', { key: 'CVE-2025-1111' }),
  node('mr-42', 'MergeRequest', {
    key: '!42',
    title: 'bump express to 4.21.2',
    url: 'https://gitlab.com/examplebank/customer-portal/-/merge_requests/42',
    state: 'merged',
  }),
];

const edges: GraphEdge[] = [
  { id: 'e1', type: 'HAS_DEPLOYMENT', source: 'app-cp', target: 'dep-cp', properties: {} },
  { id: 'e2', type: 'EXPOSES', source: 'dep-cp', target: 'h1', properties: {} },
  { id: 'e3', type: 'AFFECTS', source: 'f4', target: 'h1', properties: {} },
  { id: 'e4', type: 'INSTANCE_OF', source: 'f1', target: 'v-1111', properties: {} },
  { id: 'e5', type: 'INSTANCE_OF', source: 'f5', target: 'v-1111', properties: {} },
  { id: 'e6', type: 'FIXED_BY', source: 'f2', target: 'mr-42', properties: {} },
  { id: 'e7', type: 'FIXED_BY', source: 'f3', target: 'mr-42', properties: {} },
];

const calls: LlmCallSummary[] = [
  { callId: 'c1', runId: 'r1', model: 'claude-sonnet-4-5', scopeId: 'scope-cp', promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
  { callId: 'c2', runId: 'r1', model: 'claude-sonnet-4-5', scopeId: 'scope-cp', promptTokens: 2000, completionTokens: 1000, totalTokens: 3000 },
  // Another Application's spend must never land on this report.
  { callId: 'c3', runId: 'r2', model: 'claude-sonnet-4-5', scopeId: 'scope-tr', promptTokens: 9000, completionTokens: 9000, totalTokens: 18000 },
];

const input: ReportInput = { nodes, edges, calls, applicationKey: 'customer-portal' };

describe('deriveApplicationReport', () => {
  it('resolves the Application by key, with its name and scope', () => {
    const r = deriveApplicationReport(input);
    expect(r.application).toEqual({
      key: 'customer-portal',
      name: 'Customer Portal',
      scope: 'scope-cp',
    });
  });

  it('returns a null Application for a key that matches nothing', () => {
    const r = deriveApplicationReport({ ...input, applicationKey: 'no-such-app' });
    expect(r.application).toBeNull();
    expect(r.findingCount).toBe(0);
  });

  it('attaches findings by scope AND by deployment reachability', () => {
    const r = deriveApplicationReport(input);
    // f1, f2, f3, f6 by scope; f4 by reachability. f5 belongs to the other app.
    expect(r.findingCount).toBe(5);
  });

  it('never attaches another Application’s findings', () => {
    const r = deriveApplicationReport({ ...input, applicationKey: 'treasury-api' });
    // treasury-api has only f5, and no deployment path.
    expect(r.findingCount).toBe(1);
    expect(r.bySeverity.critical).toBe(1);
  });

  it('counts findings by severity', () => {
    const r = deriveApplicationReport(input);
    expect(r.bySeverity).toEqual({ critical: 1, high: 1, medium: 1, low: 1, info: 0 });
  });

  it('counts findings by status', () => {
    const r = deriveApplicationReport(input);
    expect(r.byStatus).toEqual({ open: 1, fixing: 1, fixed: 1, verified: 1 });
  });

  it('counts an unlabelled finding as unknown rather than bucketing it into info or open', () => {
    const r = deriveApplicationReport(input);
    expect(r.unknownSeverity).toBe(1);
    expect(r.unknownStatus).toBe(1);
    expect(r.bySeverity.info).toBe(0);
    expect(r.byStatus.open).toBe(1); // f1 only, not f6
  });

  it('reports one Vulnerability node with its tenant-wide fan-in', () => {
    const r = deriveApplicationReport(input);
    expect(r.vulnerabilities).toEqual([
      {
        key: 'CVE-2025-1111',
        findingsHere: 1,
        findingsTenantWide: 2,
        topSeverity: 'critical',
      },
    ]);
  });

  it('lists merge requests with their link and how many findings they fix', () => {
    const r = deriveApplicationReport(input);
    expect(r.mergeRequests).toEqual([
      {
        key: '!42',
        title: 'bump express to 4.21.2',
        url: 'https://gitlab.com/examplebank/customer-portal/-/merge_requests/42',
        state: 'merged',
        fixesFindings: 2,
      },
    ]);
  });

  it('attributes cost by scope and excludes another Application’s calls', () => {
    const r = deriveApplicationReport(input);
    expect(r.cost.attributedBy).toBe('scope');
    expect(r.cost.llmCallCount).toBe(2);
    expect(r.cost.estimatedCostUsd).toBeGreaterThan(0);

    // The excluded call is 6x the tokens of both included ones, so a report
    // that leaked it would be obvious.
    const leaked = deriveApplicationReport({ ...input, applicationKey: 'treasury-api' });
    expect(leaked.cost.llmCallCount).toBe(1);
    expect(leaked.cost.estimatedCostUsd).toBeGreaterThan(r.cost.estimatedCostUsd);
  });

  it('claims no cost when the Application has no scope to join on', () => {
    const scopeless = nodes.map((n) =>
      n.id === 'app-cp' ? node('app-cp', 'Application', { key: 'customer-portal', name: 'Customer Portal' }) : n,
    );
    const r = deriveApplicationReport({ ...input, nodes: scopeless });
    expect(r.cost).toEqual({ estimatedCostUsd: 0, llmCallCount: 0, attributedBy: 'none' });
  });

  it('reports both time measures as unmeasurable, with the reason', () => {
    const r = deriveApplicationReport(input);
    expect(r.timeToVerified).toEqual({ measurable: false, reason: NO_FINDING_TIMESTAMPS });
    expect(r.timeline).toEqual({ measurable: false, reason: NO_FINDING_TIMESTAMPS });
  });

  it('is pure: the same input yields a deeply equal report', () => {
    expect(deriveApplicationReport(input)).toEqual(deriveApplicationReport(input));
  });

  it('handles an Application with no findings at all', () => {
    const lonely = [node('app-x', 'Application', { key: 'lonely', name: 'Lonely', scope: 'scope-x' })];
    const r = deriveApplicationReport({ nodes: lonely, edges: [], calls: [], applicationKey: 'lonely' });
    expect(r.application?.key).toBe('lonely');
    expect(r.findingCount).toBe(0);
    expect(r.vulnerabilities).toEqual([]);
    expect(r.mergeRequests).toEqual([]);
  });
});
