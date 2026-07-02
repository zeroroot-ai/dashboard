'use client';

import Link from 'next/link';
import { Network } from 'lucide-react';

// ============================================================================
// GraphCitationChip
// ============================================================================

interface GraphCitationChipProps {
  nodeId: string;
}

/**
 * Renders a small citation chip that links to a specific knowledge-graph node
 * in the graph explorer. Used below assistant messages to surface the source
 * node when the model cited data from a focused graph node.
 */
export function GraphCitationChip({ nodeId }: GraphCitationChipProps) {
  const MAX_DISPLAY_LENGTH = 20;
  const displayId =
    nodeId.length > MAX_DISPLAY_LENGTH
      ? `${nodeId.slice(0, MAX_DISPLAY_LENGTH)}…`
      : nodeId;

  return (
    <Link
      href={`/dashboard/graph?nodeId=${encodeURIComponent(nodeId)}`}
      className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted/80"
    >
      <Network className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span>Source: {displayId}</span>
    </Link>
  );
}
