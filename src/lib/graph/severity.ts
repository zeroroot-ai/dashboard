/**
 * Finding-severity helpers (pure).
 *
 * Shared by the severity heatmap (node color/size/halo) and the legend scale.
 * Lives under `src/lib/` for unit testing.
 */

import type { GraphNode } from '@/src/types/graph';
import { parseEntityType } from '@/src/lib/graph/entity-taxonomy';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Severity levels, most → least severe. */
export const SEVERITY_LEVELS: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

const WEIGHTS: Record<Severity, number> = {
  critical: 1,
  high: 0.8,
  medium: 0.6,
  low: 0.4,
  info: 0.2,
};

/** Normalized 0..1 weight for a severity (critical = 1). Unknown → 0. */
export function severityWeight(severity: string | null | undefined): number {
  if (!severity) return 0;
  return WEIGHTS[severity.toLowerCase() as Severity] ?? 0;
}

/**
 * The severity of a node if it is a finding, else null. Only finding nodes
 * carry a meaningful severity for the heatmap.
 */
export function nodeSeverity(node: GraphNode): Severity | null {
  if (parseEntityType(node.labels) !== 'finding') return null;
  const sev = node.properties?.severity;
  if (typeof sev !== 'string') return null;
  const lower = sev.toLowerCase();
  return (SEVERITY_LEVELS as string[]).includes(lower) ? (lower as Severity) : null;
}
