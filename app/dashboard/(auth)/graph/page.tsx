'use client';

import { useState, useCallback } from 'react';
import { SlidersHorizontal, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { KnowledgeGraph3D } from '@/components/gibson/graph/KnowledgeGraph3D';
import { GraphFilters, type GraphFilters as GraphFiltersType } from '@/components/gibson/graph/GraphFilters';
import { Graph3DControls } from '@/components/gibson/graph/Graph3DControls';
import type { GraphNodeType } from '@/src/types/index';

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

const DEFAULT_FILTERS: GraphFiltersType = {
  nodeTypes: ALL_NODE_TYPES,
  relationshipTypes: [],
  layout: 'force',
  depth: 3,
  search: '',
};

export default function GraphPage() {
  const [filters, setFilters] = useState<GraphFiltersType>(DEFAULT_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const handleFiltersChange = useCallback((updated: GraphFiltersType) => {
    setFilters(updated);
  }, []);

  const handleToggleFilters = useCallback(() => {
    setFiltersOpen((prev) => !prev);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  return (
    <div
      className="relative w-full rounded-lg overflow-hidden border border-border bg-background"
      style={{ height: 'var(--content-full-height)' }}
    >
      {/* 3D Graph Canvas — fills the container */}
      <KnowledgeGraph3D />

      {/* Overlay controls — positioned inside the relative container */}
      <Graph3DControls
        position="top-right"
        compact
        filtersOpen={filtersOpen}
        onToggleFilters={handleToggleFilters}
        onOpenSettings={handleOpenSettings}
      />

      {/* Filters trigger — bottom-left floating button (mobile-friendly) */}
      <div className="absolute bottom-4 left-4 z-20 md:hidden">
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="bg-background/80 backdrop-blur-sm">
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              Filters
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0">
            <SheetHeader className="px-4 py-3 border-b border-border">
              <SheetTitle>Graph Filters</SheetTitle>
            </SheetHeader>
            <div className="overflow-y-auto h-full pb-8">
              <GraphFilters
                filters={filters}
                onFiltersChange={handleFiltersChange}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Filters Sheet — desktop slide-in from left */}
      <div className="absolute top-4 left-4 z-20 hidden md:block">
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="bg-background/80 backdrop-blur-sm"
              aria-label="Toggle filter panel"
            >
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              Filters
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0">
            <SheetHeader className="px-4 py-3 border-b border-border">
              <SheetTitle>Graph Filters</SheetTitle>
            </SheetHeader>
            <div className="overflow-y-auto h-full pb-8">
              <GraphFilters
                filters={filters}
                onFiltersChange={handleFiltersChange}
              />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Settings Sheet — slides in from right */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-80">
          <SheetHeader className="border-b border-border pb-3">
            <SheetTitle className="flex items-center gap-2">
              <Settings2 className="w-4 h-4" />
              Graph Settings
            </SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 py-4">
            <p className="text-sm text-muted-foreground">
              Performance and display settings for the 3D knowledge graph.
            </p>
            {/* Future: performance settings, LOD controls, export options */}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
