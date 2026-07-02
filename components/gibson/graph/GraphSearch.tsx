'use client';

/**
 * GraphSearch
 *
 * Search-to-focus box: type a node name, pick a match (or press Enter for the
 * first), and the parent centers + selects it. Matching is the pure `matchNodes`
 * helper, so the dropdown and the Enter behavior agree.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { GraphNode } from '@/src/types/graph';
import { matchNodes, getNodeDisplayName } from '@/src/lib/graph/search';

interface GraphSearchProps {
  nodes: GraphNode[];
  onFocusNode: (node: GraphNode) => void;
  className?: string;
}

export function GraphSearch({ nodes, onFocusNode, className }: GraphSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => matchNodes(nodes, query), [nodes, query]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (node: GraphNode) => {
    onFocusNode(node);
    setQuery(getNodeDisplayName(node));
    setOpen(false);
  };

  const noMatch = query.trim().length > 0 && matches.length === 0;

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          value={query}
          placeholder="Search nodes…"
          aria-label="Search nodes"
          className="h-8 pl-8 pr-8 w-56 bg-background/80 backdrop-blur-sm"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches.length > 0) {
              e.preventDefault();
              pick(matches[0]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {open && (matches.length > 0 || noMatch) && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-background shadow-lg">
          {noMatch ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No matching nodes</div>
          ) : (
            matches.map((n) => (
              <button
                key={n.id}
                type="button"
                className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left hover:bg-accent"
                onClick={() => pick(n)}
              >
                <span className="text-sm text-foreground truncate w-full">{getNodeDisplayName(n)}</span>
                {n.labels[0] && (
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                    {n.labels[0]}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

