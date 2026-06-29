import {
  worldToGraph,
  type WorldGraphMission,
  type WorldGraphHost,
  type WorldGraphFinding,
} from '@/components/gibson/brain/WorldGraph';
import type { GraphNode } from '@/src/types/graph';

/**
 * Frame is a folded World frame's entity slice — the shape /api/world/frame
 * returns (missions/hosts/findings at a Timeline position). Diffing two adjacent
 * frames yields what changed at the tick between them.
 */
export interface Frame {
  missions: WorldGraphMission[];
  hosts: WorldGraphHost[];
  findings: WorldGraphFinding[];
}

export type EntityKind = 'mission' | 'host' | 'finding';
export type ChangeType = 'added' | 'removed' | 'changed';

export interface ChangedEntity {
  /** Graph node id — matches WorldGraph's projection so highlight + panel agree. */
  id: string;
  kind: EntityKind;
  /** Human label: mission goal / host address / finding title. */
  label: string;
  change: ChangeType;
}

export interface FrameDiff {
  /** Every entity that changed at this tick, ordered added → changed → removed. */
  entities: ChangedEntity[];
  /** Node ids introduced or changed (present in the after-frame) — graph highlight. */
  highlightNodeIds: string[];
  /** Edge ids introduced at this tick (present in the after-frame) — graph highlight. */
  highlightEdgeIds: string[];
}

function labelFor(node: GraphNode): string {
  const p = node.properties;
  switch (node.entityType) {
    case 'mission':
      return String(p.goal ?? node.id);
    case 'host':
      return String(p.address ?? node.id);
    case 'finding':
      return String(p.title ?? node.id);
    default:
      return node.id;
  }
}

function toChanged(node: GraphNode, change: ChangeType): ChangedEntity {
  return {
    id: node.id,
    kind: (node.entityType ?? 'mission') as EntityKind,
    label: labelFor(node),
    change,
  };
}

/**
 * diffFrames computes what changed between two adjacent folded frames (the World
 * at seq N-1 vs seq N — ADR-0001: World == fold(Timeline)). It is the testable
 * seam behind the per-tick inspector (gibson#1059): pure, deterministic, and
 * client-side, so the inspector needs no backend change. Both frames are projected
 * through `worldToGraph` (the single source of node/edge identity), then diffed by
 * id — added (in `after` only), removed (in `before` only), and changed (present in
 * both, properties differ). Removed entities are reported but never highlighted:
 * they are absent from the rendered after-frame. Degrades to "all added" when
 * `before` is the empty seq-0 frame, and to an empty diff when nothing changed.
 */
export function diffFrames(before: Frame, after: Frame): FrameDiff {
  const a = worldToGraph(before.missions, before.hosts, before.findings);
  const b = worldToGraph(after.missions, after.hosts, after.findings);

  const beforeNodes = new Map(a.nodes.map((n) => [n.id, n]));
  const afterNodes = new Map(b.nodes.map((n) => [n.id, n]));
  const beforeEdgeIds = new Set(a.edges.map((e) => e.id));

  const entities: ChangedEntity[] = [];
  const highlightNodeIds: string[] = [];

  // Added or changed: present in the after-frame, so safe to highlight.
  for (const node of b.nodes) {
    const prev = beforeNodes.get(node.id);
    if (!prev) {
      entities.push(toChanged(node, 'added'));
      highlightNodeIds.push(node.id);
    } else if (
      JSON.stringify(prev.properties) !== JSON.stringify(node.properties)
    ) {
      entities.push(toChanged(node, 'changed'));
      highlightNodeIds.push(node.id);
    }
  }
  // Removed: present in before, gone from after. Not highlighted (not rendered).
  for (const node of a.nodes) {
    if (!afterNodes.has(node.id)) entities.push(toChanged(node, 'removed'));
  }

  const highlightEdgeIds = b.edges
    .filter((e) => !beforeEdgeIds.has(e.id))
    .map((e) => e.id);

  const rank: Record<ChangeType, number> = { added: 0, changed: 1, removed: 2 };
  entities.sort(
    (x, y) => rank[x.change] - rank[y.change] || x.id.localeCompare(y.id),
  );

  return { entities, highlightNodeIds, highlightEdgeIds };
}
