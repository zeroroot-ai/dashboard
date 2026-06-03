'use client';

import { useCallback } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DEFAULT_GRAPH_FILTERS,
  type GraphFilterState,
  type SeverityFloor,
} from '@/src/lib/graph/filters';

export type { GraphFilterState } from '@/src/lib/graph/filters';

export interface GraphFiltersProps {
  filters: GraphFilterState;
  onFiltersChange: (filters: GraphFilterState) => void;
  /** Entity types present in the current graph (toggle targets). */
  availableNodeTypes: string[];
  /** Relationship types present in the current graph (toggle targets). */
  availableRelationshipTypes: string[];
}

const SEVERITY_OPTIONS: { value: SeverityFloor; label: string }[] = [
  { value: 'all', label: 'All severities' },
  { value: 'info', label: 'Info and up' },
  { value: 'low', label: 'Low and up' },
  { value: 'medium', label: 'Medium and up' },
  { value: 'high', label: 'High and up' },
  { value: 'critical', label: 'Critical only' },
];

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * GraphFilters
 *
 * Control panel for narrowing the rendered knowledge graph. Toggles are derived
 * from the data actually present; everything shows by default and a type is
 * hidden only when explicitly toggled off. Layout selection lives in the
 * controls panel, not here (dashboard#667).
 */
export function GraphFilters({
  filters,
  onFiltersChange,
  availableNodeTypes,
  availableRelationshipTypes,
}: GraphFiltersProps) {
  const toggleHidden = useCallback(
    (key: 'hiddenNodeTypes' | 'hiddenRelationshipTypes', value: string) => {
      const set = new Set(filters[key]);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      onFiltersChange({ ...filters, [key]: [...set] });
    },
    [filters, onFiltersChange]
  );

  const handleReset = useCallback(() => {
    onFiltersChange({ ...DEFAULT_GRAPH_FILTERS });
  }, [onFiltersChange]);

  return (
    <div className="flex flex-col gap-5 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Filters
        </span>
        <Button variant="outline" size="sm" onClick={handleReset} title="Reset filters">
          <RotateCcw className="w-4 h-4 mr-1" />
          Reset
        </Button>
      </div>

      {/* Node types */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Node types
        </Label>
        {availableNodeTypes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No nodes loaded.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {availableNodeTypes.map((t) => {
              const active = !filters.hiddenNodeTypes.includes(t);
              return (
                <Badge
                  key={t}
                  variant={active ? 'default' : 'outline'}
                  className="cursor-pointer select-none"
                  onClick={() => toggleHidden('hiddenNodeTypes', t)}
                >
                  {titleCase(t)}
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      {/* Relationship types */}
      {availableRelationshipTypes.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Relationship types
          </Label>
          <div className="flex flex-wrap gap-2">
            {availableRelationshipTypes.map((t) => {
              const active = !filters.hiddenRelationshipTypes.includes(t);
              return (
                <Badge
                  key={t}
                  variant={active ? 'default' : 'outline'}
                  className="cursor-pointer select-none"
                  onClick={() => toggleHidden('hiddenRelationshipTypes', t)}
                >
                  {t}
                </Badge>
              );
            })}
          </div>
        </div>
      )}

      {/* Finding severity floor */}
      <div className="flex flex-col gap-2">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Finding severity
        </Label>
        <Select
          value={filters.severityFloor}
          onValueChange={(v) => onFiltersChange({ ...filters, severityFloor: v as SeverityFloor })}
        >
          <SelectTrigger className="w-full h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEVERITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Depth */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Depth from roots
          </Label>
          <span className="text-sm font-medium text-foreground tabular-nums">
            {filters.depth === 0 ? 'All' : filters.depth}
          </span>
        </div>
        <Slider
          min={0}
          max={6}
          step={1}
          value={[filters.depth]}
          onValueChange={([v]) => onFiltersChange({ ...filters, depth: v })}
          className="w-full"
        />
      </div>
    </div>
  );
}
