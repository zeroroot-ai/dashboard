'use client';

import { useState, useCallback, useEffect } from 'react';
import { Search, X, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import type { GraphNodeType } from '@/src/types/index';

/**
 * Graph filter state
 */
export interface GraphFilters {
  /** Selected node types to display */
  nodeTypes: GraphNodeType[];
  /** Relationship types to display */
  relationshipTypes: string[];
  /** Layout algorithm */
  layout: 'force' | 'hierarchical';
  /** Depth from selected node (1-5 hops) */
  depth: number;
  /** Search query */
  search: string;
}

export interface GraphFiltersProps {
  /** Current filter values */
  filters: GraphFilters;
  /** Callback when filters change */
  onFiltersChange: (filters: GraphFilters) => void;
  /** Available relationship types from the graph */
  availableRelationshipTypes?: string[];
}

/**
 * All available node types
 */
const ALL_NODE_TYPES: GraphNodeType[] = [
  'Mission',
  'Agent',
  'Host',
  'Service',
  'Vulnerability',
  'Finding',
  'Endpoint',
  'User',
  'Credential',
];

/**
 * Node type colors matching KnowledgeGraph3D
 */
const NODE_TYPE_COLORS: Record<GraphNodeType, string> = {
  Mission: '#ffb000',
  Agent: '#ff8c00',
  Host: '#3b82f6',
  Service: '#8b5cf6',
  Vulnerability: '#ff4433',
  Finding: '#ff6633',
  Endpoint: '#33ff33',
  User: '#06b6d4',
  Credential: '#eab308',
};

/**
 * GraphFilters Component
 *
 * Control panel for knowledge graph display options.
 *
 * Features:
 * - Node type toggles (show/hide each type)
 * - Relationship type filter
 * - Layout selector (Force/Hierarchical)
 * - Depth slider (1-5 hops from selected node)
 * - Search input to find and center on node
 * - Reset button to clear all filters
 */
export function GraphFilters({
  filters,
  onFiltersChange,
  availableRelationshipTypes = [],
}: GraphFiltersProps) {
  const [searchInput, setSearchInput] = useState(filters.search);

  // Debounce search input
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (searchInput !== filters.search) {
        onFiltersChange({ ...filters, search: searchInput });
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [searchInput, filters, onFiltersChange]);

  // Toggle node type
  const toggleNodeType = useCallback(
    (type: GraphNodeType) => {
      const newTypes = filters.nodeTypes.includes(type)
        ? filters.nodeTypes.filter((t) => t !== type)
        : [...filters.nodeTypes, type];
      onFiltersChange({ ...filters, nodeTypes: newTypes });
    },
    [filters, onFiltersChange]
  );

  // Toggle relationship type
  const toggleRelationshipType = useCallback(
    (type: string) => {
      const newTypes = filters.relationshipTypes.includes(type)
        ? filters.relationshipTypes.filter((t) => t !== type)
        : [...filters.relationshipTypes, type];
      onFiltersChange({ ...filters, relationshipTypes: newTypes });
    },
    [filters, onFiltersChange]
  );

  // Change layout
  const handleLayoutChange = useCallback(
    (layout: 'force' | 'hierarchical') => {
      onFiltersChange({ ...filters, layout });
    },
    [filters, onFiltersChange]
  );

  // Change depth
  const handleDepthChange = useCallback(
    (depth: number) => {
      onFiltersChange({ ...filters, depth });
    },
    [filters, onFiltersChange]
  );

  // Reset all filters
  const handleReset = useCallback(() => {
    const defaultFilters: GraphFilters = {
      nodeTypes: ALL_NODE_TYPES,
      relationshipTypes: [],
      layout: 'force',
      depth: 3,
      search: '',
    };
    setSearchInput('');
    onFiltersChange(defaultFilters);
  }, [onFiltersChange]);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Search and Reset */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search nodes..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleReset}
          title="Reset filters"
        >
          <RotateCcw className="w-4 h-4" />
          Reset
        </Button>
      </div>

      {/* Layout Selector */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Layout
        </label>
        <div className="flex gap-2">
          <Button
            variant={filters.layout === 'force' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => handleLayoutChange('force')}
          >
            Force
          </Button>
          <Button
            variant={filters.layout === 'hierarchical' ? 'default' : 'outline'}
            size="sm"
            className="flex-1"
            onClick={() => handleLayoutChange('hierarchical')}
          >
            Hierarchical
          </Button>
        </div>
      </div>

      {/* Depth Slider */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Depth (Hops)
          </label>
          <span className="text-sm font-medium text-foreground">
            {filters.depth}
          </span>
        </div>
        <input
          type="range"
          min="1"
          max="5"
          value={filters.depth}
          onChange={(e) => handleDepthChange(parseInt(e.target.value))}
          className="w-full h-2 bg-accent rounded-lg appearance-none cursor-pointer accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>1</span>
          <span>2</span>
          <span>3</span>
          <span>4</span>
          <span>5</span>
        </div>
      </div>

      {/* Node Type Toggles */}
      <div className="flex flex-col gap-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Node Types
        </label>
        <div className="flex flex-wrap gap-2">
          {ALL_NODE_TYPES.map((type) => {
            const isActive = filters.nodeTypes.includes(type);
            const color = NODE_TYPE_COLORS[type];

            return (
              <button
                key={type}
                onClick={() => toggleNodeType(type)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border-2 ${
                  isActive
                    ? 'border-opacity-100 bg-opacity-10'
                    : 'border-opacity-30 bg-opacity-0 opacity-50 hover:opacity-100'
                }`}
                style={{
                  borderColor: color,
                  backgroundColor: isActive ? `${color}20` : 'transparent',
                  color: color,
                }}
              >
                {type}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {filters.nodeTypes.length} of {ALL_NODE_TYPES.length} types visible
        </p>
      </div>

      {/* Relationship Type Toggles */}
      {availableRelationshipTypes.length > 0 && (
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Relationship Types
          </label>
          <div className="flex flex-wrap gap-2">
            {availableRelationshipTypes.map((type) => {
              const isActive =
                filters.relationshipTypes.length === 0 ||
                filters.relationshipTypes.includes(type);

              return (
                <Badge
                  key={type}
                  variant={isActive ? 'default' : 'outline'}
                  className="cursor-pointer select-none"
                  onClick={() => toggleRelationshipType(type)}
                >
                  {type}
                </Badge>
              );
            })}
          </div>
          {filters.relationshipTypes.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {filters.relationshipTypes.length} of{' '}
              {availableRelationshipTypes.length} types visible
            </p>
          )}
        </div>
      )}
    </div>
  );
}
