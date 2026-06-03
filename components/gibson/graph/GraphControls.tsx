'use client';

/**
 * GraphControls
 *
 * Overlay control panel for the knowledge-graph explorer. Camera actions
 * (zoom/fit/reset) are delegated to the engine via callbacks wired to the
 * `GraphCanvasHandle`; view toggles and the live stats HUD read/write the
 * consolidated `graph-view-store`.
 *
 * The layout switcher (force/hierarchy/radial/timeline) and the full Settings
 * panel land in dashboard#665 / dashboard#666; this slice ships the controls
 * that are fully functional today.
 */

import { cn } from '@/lib/utils';
import { useGraphViewStore } from '@/src/stores/graph-view-store';
import { useGraph3DPerformance } from '@/src/hooks/useGraph3DPerformance';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  Tag,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

export interface GraphControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onReset: () => void;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  className?: string;
}

const POSITION_CLASSES: Record<NonNullable<GraphControlsProps['position']>, string> = {
  'top-left': 'top-4 left-4',
  'top-right': 'top-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-right': 'bottom-4 right-4',
};

function ControlButton({
  onClick,
  icon: Icon,
  label,
  active,
}: {
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-center w-9 h-9 rounded-lg border transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background/80 hover:bg-background border-border text-muted-foreground hover:text-foreground'
      )}
      title={label}
      aria-label={label}
      aria-pressed={active}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}

function ControlGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 p-1 rounded-lg bg-background/80 backdrop-blur-sm border border-border">
      {children}
    </div>
  );
}

export function GraphControls({
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
  position = 'top-right',
  className,
}: GraphControlsProps) {
  const showLabels = useGraphViewStore((s) => s.display.showLabels);
  const particles = useGraphViewStore((s) => s.display.particles);
  const toggleLabels = useGraphViewStore((s) => s.toggleLabels);
  const toggleParticles = useGraphViewStore((s) => s.toggleParticles);
  const nodeCount = useGraphViewStore((s) => s.nodeCount);
  const edgeCount = useGraphViewStore((s) => s.edgeCount);

  const { avgFPS } = useGraph3DPerformance(nodeCount);

  return (
    <div className={cn('absolute z-20 flex flex-col gap-2', POSITION_CLASSES[position], className)}>
      {/* Camera */}
      <ControlGroup>
        <ControlButton onClick={onZoomIn} icon={ZoomIn} label="Zoom in" />
        <ControlButton onClick={onZoomOut} icon={ZoomOut} label="Zoom out" />
        <ControlButton onClick={onFit} icon={Maximize} label="Fit to view" />
        <ControlButton onClick={onReset} icon={RotateCcw} label="Reset view" />
      </ControlGroup>

      {/* View toggles */}
      <ControlGroup>
        <ControlButton
          onClick={toggleLabels}
          icon={Tag}
          label={showLabels ? 'Hide labels' : 'Show labels'}
          active={showLabels}
        />
        <ControlButton
          onClick={toggleParticles}
          icon={Sparkles}
          label={particles ? 'Disable particles' : 'Enable particles'}
          active={particles}
        />
      </ControlGroup>

      {/* Stats HUD */}
      <div className="flex flex-col gap-1 p-2 rounded-lg bg-background/90 backdrop-blur-md border border-border text-xs font-mono">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Nodes</span>
          <span className="text-foreground font-semibold tabular-nums">{nodeCount}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Edges</span>
          <span className="text-foreground font-semibold tabular-nums">{edgeCount}</span>
        </div>
        {avgFPS > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-1 mt-0.5">
            <span className="text-muted-foreground">FPS</span>
            <span
              className={cn(
                'font-semibold tabular-nums',
                avgFPS >= 50 ? 'text-highlight' : avgFPS >= 30 ? 'text-alt' : 'text-destructive'
              )}
            >
              {avgFPS}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default GraphControls;
