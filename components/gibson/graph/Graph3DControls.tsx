'use client';

/**
 * Graph3DControls Component
 *
 * Camera and visualization controls for the 3D knowledge graph.
 * Provides buttons for zoom, rotate, fit-to-view, reset, and layout switching.
 */

import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  useGraph3DCamera,
  useGraph3DLayout,
  useGraph3DPerformance,
  type LayoutMode,
} from '@/src/stores/graph3d-store';
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  Grid3X3,
  GitBranch,
  Circle,
  Clock,
  Layers,
  Settings,
  Eye,
  EyeOff,
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface Graph3DControlsProps {
  /** CSS class name */
  className?: string;
  /** Callback to open settings dialog */
  onOpenSettings?: () => void;
  /** Callback to toggle filters panel */
  onToggleFilters?: () => void;
  /** Whether filters are currently shown */
  filtersOpen?: boolean;
  /** Position of controls */
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Compact mode (icons only) */
  compact?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const LAYOUT_OPTIONS: { mode: LayoutMode; label: string; icon: typeof Grid3X3 }[] = [
  { mode: 'force', label: 'Force-Directed', icon: Grid3X3 },
  { mode: 'dag', label: 'Hierarchy (DAG)', icon: GitBranch },
  { mode: 'radial', label: 'Radial', icon: Circle },
  { mode: 'timeline', label: 'Timeline', icon: Clock },
];

const POSITION_CLASSES = {
  'top-left': 'top-4 left-4',
  'top-right': 'top-4 right-4',
  'bottom-left': 'bottom-4 left-4',
  'bottom-right': 'bottom-4 right-4',
};

// ============================================================================
// Helper Components
// ============================================================================

interface ControlButtonProps {
  onClick: () => void;
  icon: typeof ZoomIn;
  label: string;
  active?: boolean;
  disabled?: boolean;
  compact?: boolean;
}

function ControlButton({
  onClick,
  icon: Icon,
  label,
  active,
  disabled,
  compact,
}: ControlButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center justify-center gap-2 transition-colors',
        compact ? 'w-9 h-9' : 'px-3 py-2',
        'rounded-lg border',
        active
          ? 'bg-primary text-primary-foreground border-primary'
          : 'bg-background/80 hover:bg-background border-border text-muted-foreground hover:text-foreground',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      title={label}
      aria-label={label}
    >
      <Icon className="w-4 h-4" />
      {!compact && <span className="text-sm">{label}</span>}
    </button>
  );
}

interface ControlGroupProps {
  children: React.ReactNode;
  label?: string;
  vertical?: boolean;
}

function ControlGroup({ children, label, vertical }: ControlGroupProps) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <span className="text-xs text-muted-foreground uppercase tracking-wider px-1">
          {label}
        </span>
      )}
      <div
        className={cn(
          'flex gap-1 p-1 rounded-lg bg-background/80 backdrop-blur-sm border border-border',
          vertical ? 'flex-col' : 'flex-row'
        )}
      >
        {children}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function Graph3DControls({
  className,
  onOpenSettings,
  onToggleFilters,
  filtersOpen = false,
  position = 'top-right',
  compact = false,
}: Graph3DControlsProps) {
  const { camera, setCamera, resetCamera, fitToView } = useGraph3DCamera();
  const { layoutMode, layoutAnimating, setLayoutMode } = useGraph3DLayout();
  const { currentFPS, nodeCount, edgeCount } = useGraph3DPerformance();

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setCamera({ zoom: Math.min(camera.zoom * 1.2, 3) });
  }, [camera.zoom, setCamera]);

  const handleZoomOut = useCallback(() => {
    setCamera({ zoom: Math.max(camera.zoom / 1.2, 0.2) });
  }, [camera.zoom, setCamera]);

  return (
    <div
      className={cn(
        'absolute z-20 flex flex-col gap-2',
        POSITION_CLASSES[position],
        className
      )}
    >
      {/* Zoom Controls */}
      <ControlGroup vertical>
        <ControlButton
          onClick={handleZoomIn}
          icon={ZoomIn}
          label="Zoom In"
          compact={compact}
        />
        <ControlButton
          onClick={handleZoomOut}
          icon={ZoomOut}
          label="Zoom Out"
          compact={compact}
        />
        <ControlButton
          onClick={fitToView}
          icon={Maximize}
          label="Fit to View"
          compact={compact}
        />
        <ControlButton
          onClick={resetCamera}
          icon={RotateCcw}
          label="Reset Camera"
          compact={compact}
        />
      </ControlGroup>

      {/* Layout Controls */}
      <ControlGroup label={compact ? undefined : 'Layout'} vertical>
        {LAYOUT_OPTIONS.map(({ mode, label, icon }) => (
          <ControlButton
            key={mode}
            onClick={() => setLayoutMode(mode)}
            icon={icon}
            label={label}
            active={layoutMode === mode}
            disabled={layoutAnimating}
            compact={compact}
          />
        ))}
      </ControlGroup>

      {/* View Controls */}
      <ControlGroup vertical>
        {onToggleFilters && (
          <ControlButton
            onClick={onToggleFilters}
            icon={filtersOpen ? EyeOff : Eye}
            label={filtersOpen ? 'Hide Filters' : 'Show Filters'}
            active={filtersOpen}
            compact={compact}
          />
        )}
        <ControlButton
          onClick={() => {}}
          icon={Layers}
          label="Toggle Layers"
          compact={compact}
        />
        {onOpenSettings && (
          <ControlButton
            onClick={onOpenSettings}
            icon={Settings}
            label="Settings"
            compact={compact}
          />
        )}
      </ControlGroup>

      {/* Stats / FPS HUD — high-contrast panel, WCAG AA text */}
      <div className="flex flex-col gap-1 p-2 rounded-lg bg-background/90 backdrop-blur-md border border-border text-xs font-mono">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Nodes</span>
          <span className="text-foreground font-semibold tabular-nums">{nodeCount}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Edges</span>
          <span className="text-foreground font-semibold tabular-nums">{edgeCount}</span>
        </div>
        {currentFPS > 0 && (
          <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-1 mt-0.5">
            <span className="text-muted-foreground">FPS</span>
            <span className={cn(
              'font-semibold tabular-nums',
              currentFPS >= 50
                ? 'text-highlight'
                : currentFPS >= 30
                ? 'text-alt'
                : 'text-destructive'
            )}>
              {currentFPS}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default Graph3DControls;
