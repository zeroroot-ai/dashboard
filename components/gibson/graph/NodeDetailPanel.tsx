'use client';

/**
 * NodeDetailPanel — Phase 5, Task 19
 *
 * Shadcn Sheet panel that shows detail for the currently-selected graph node.
 * Portal-mounted so closing it does not affect the underlying canvas state
 * (zoom/pan preserved). Includes "Find paths from this node" + "Open in
 * mission view" placeholder links.
 */

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ExternalLink, GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GraphNode } from '@/src/types/graph';

interface NodeDetailPanelProps {
  node: GraphNode | null;
  onClose: () => void;
  /** Called when user clicks "Find paths from this node" */
  onFindPaths: (node: GraphNode) => void;
}

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

const SEVERITY_CLASSES: Record<Severity, string> = {
  critical: 'bg-destructive/20 text-destructive border-destructive/30',
  high: 'bg-alt/20 text-alt border-alt/30',
  medium: 'bg-alt/20 text-alt border-alt/30',
  low: 'bg-link/20 text-link border-link/30',
  info: 'bg-muted/20 text-muted-foreground border-border/30',
};

function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function formatTimestamp(ts: unknown): string {
  if (!ts) return '';
  try {
    const d = new Date(typeof ts === 'number' ? ts : String(ts));
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString();
  } catch {
    return String(ts);
  }
}

/** Properties to skip in the generic table (rendered separately above). */
const SKIP_PROPS = new Set(['name', 'severity', 'first_seen_at', 'firstSeenAt', 'addedAt', 'mission_id', 'missionId']);

export function NodeDetailPanel({ node, onClose, onFindPaths }: NodeDetailPanelProps) {
  const isOpen = node !== null;

  if (!node) {
    return (
      <Sheet open={false} onOpenChange={() => onClose()}>
        <SheetContent side="right" className="w-96" />
      </Sheet>
    );
  }

  const name = (node.properties.name as string | undefined) || node.id;
  const severity = node.properties.severity as Severity | undefined;
  const firstSeenAtRaw = node.properties.first_seen_at ?? node.properties.firstSeenAt;
  const firstSeenAt = firstSeenAtRaw as string | number | null | undefined;
  const missionIdRaw = node.properties.mission_id ?? node.properties.missionId;
  const missionId = missionIdRaw as string | null | undefined;

  // Generic properties table (exclude the specially-rendered ones)
  const genericProps = Object.entries(node.properties).filter(
    ([k]) => !SKIP_PROPS.has(k)
  );

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-96 overflow-y-auto">
        <SheetHeader className="border-b border-border pb-3 mb-4">
          <SheetTitle className="text-base font-semibold truncate">{name}</SheetTitle>
          <SheetDescription className="flex flex-wrap gap-1 mt-1">
            {node.labels.map((label) => (
              <Badge key={label} variant="outline" className="text-xs font-mono">
                {label}
              </Badge>
            ))}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4">
          {/* Severity */}
          {severity && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-28 flex-shrink-0">Severity</span>
              <span className={cn(
                "px-2 py-0.5 rounded text-xs font-medium border",
                SEVERITY_CLASSES[severity] ?? SEVERITY_CLASSES.info
              )}>
                {severity.toUpperCase()}
              </span>
            </div>
          )}

          {/* First seen */}
          {firstSeenAt && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-28 flex-shrink-0">First seen</span>
              <span className="text-xs text-foreground font-mono">
                {formatTimestamp(firstSeenAt)}
              </span>
            </div>
          )}

          {/* Mission link */}
          {missionId && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-28 flex-shrink-0">Mission</span>
              <a
                href={`/dashboard/results/${missionId}`}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Open in mission view
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          <Separator />

          {/* Properties table */}
          {genericProps.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Properties</p>
              <div className="space-y-1.5">
                {genericProps.map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2">
                    <span className="text-xs text-muted-foreground w-28 flex-shrink-0 truncate font-mono">{key}</span>
                    <span className="text-xs text-foreground break-all">{formatPropertyValue(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Actions */}
          <div className="space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                onFindPaths(node);
                onClose();
              }}
            >
              <GitBranch className="w-4 h-4 mr-2" />
              Find paths from this node
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
