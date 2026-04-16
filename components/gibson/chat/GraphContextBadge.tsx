'use client';

import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { GraphContext } from '@/src/stores/chat-store';

// ============================================================================
// Types
// ============================================================================

export interface GraphContextBadgeProps {
  context: GraphContext;
  onDismiss: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function GraphContextBadge({ context, onDismiss }: GraphContextBadgeProps) {
  const label = context.nodeLabel || context.nodeId || 'Unknown';
  const type = context.nodeType || 'Node';

  return (
    <Badge variant="secondary" className="gap-1">
      {type}: {label}
      <button
        onClick={onDismiss}
        className="ml-1 rounded-sm hover:opacity-70"
        aria-label="Clear graph context"
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}
