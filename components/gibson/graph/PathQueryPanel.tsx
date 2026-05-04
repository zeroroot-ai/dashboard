'use client';

/**
 * PathQueryPanel — Phase 5, Task 20
 *
 * Floating panel for querying paths between graph nodes via /api/graph/paths.
 * Source-node autocomplete from current data.nodes. Target picker: by node-kind
 * dropdown OR by specific node search (radio toggle). Max-depth slider 1-10.
 * Submit POSTs /api/graph/paths and calls onPathsFound with the result for
 * the parent to set highlightedPaths on <KnowledgeGraph3D />.
 */

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { GitBranch, ChevronDown, ChevronUp, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { GraphNode } from '@/src/types/graph';

interface PathResult {
  node_ids: string[];
  edge_ids: string[];
}

interface PathQueryPanelProps {
  nodes: GraphNode[];
  /** When set, pre-fills the source node field. */
  initialSourceNode?: GraphNode | null;
  /** Called with found paths so the page can highlight them. */
  onPathsFound: (paths: PathResult[]) => void;
}

const NODE_KINDS = [
  'Mission', 'Agent', 'Host', 'Service', 'Vulnerability',
  'Finding', 'Endpoint', 'User', 'Credential', 'Domain', 'Subdomain',
  'Technology', 'Certificate', 'Evidence',
];

function NodeAutocomplete({
  nodes,
  value,
  onChange,
  placeholder,
}: {
  nodes: GraphNode[];
  value: GraphNode | null;
  onChange: (node: GraphNode | null) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Update display when value changes externally
  useEffect(() => {
    if (value) {
      setQuery((value.properties.name as string | undefined) ?? value.id);
    } else {
      setQuery('');
    }
  }, [value]);

  const filtered = query.length >= 1
    ? nodes.filter(n => {
        const name = (n.properties.name as string | undefined) ?? n.id;
        return name.toLowerCase().includes(query.toLowerCase()) ||
          n.id.toLowerCase().includes(query.toLowerCase());
      }).slice(0, 20)
    : [];

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <Input
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value) onChange(null);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="h-8 text-xs"
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-y-auto bg-background border border-border rounded shadow-lg">
          {filtered.map(node => {
            const name = (node.properties.name as string | undefined) ?? node.id;
            return (
              <button
                key={node.id}
                className="w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 flex items-center gap-2"
                onMouseDown={e => {
                  e.preventDefault();
                  onChange(node);
                  setQuery(name);
                  setOpen(false);
                }}
              >
                <span className="font-medium truncate">{name}</span>
                <span className="text-muted-foreground flex-shrink-0">{node.labels[0]}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PathQueryPanel({ nodes, initialSourceNode, onPathsFound }: PathQueryPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [sourceNode, setSourceNode] = useState<GraphNode | null>(null);
  const [targetMode, setTargetMode] = useState<'kind' | 'node'>('kind');
  const [targetKind, setTargetKind] = useState<string>('');
  const [targetNode, setTargetNode] = useState<GraphNode | null>(null);
  const [maxDepth, setMaxDepth] = useState(5);
  const [loading, setLoading] = useState(false);
  const [resultCount, setResultCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Wire initialSourceNode from NodeDetailPanel's "Find paths" button
  useEffect(() => {
    if (initialSourceNode) {
      setSourceNode(initialSourceNode);
      setExpanded(true);
    }
  }, [initialSourceNode]);

  const canSubmit = sourceNode !== null && (
    (targetMode === 'kind' && !!targetKind) ||
    (targetMode === 'node' && targetNode !== null)
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !sourceNode) return;

    setLoading(true);
    setError(null);
    setResultCount(null);

    try {
      const body: Record<string, unknown> = {
        from_node_id: sourceNode.id,
        max_depth: maxDepth,
      };
      if (targetMode === 'kind') {
        body.to_node_kind = targetKind;
      } else {
        body.to_node_id = targetNode!.id;
      }

      const resp = await fetch('/api/graph/paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const json = (await resp.json()) as { error?: string };
        setError(json.error ?? `Error ${resp.status}`);
        onPathsFound([]);
        return;
      }

      const data = await resp.json() as { paths: PathResult[] };
      setResultCount(data.paths.length);
      onPathsFound(data.paths);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      onPathsFound([]);
    } finally {
      setLoading(false);
    }
  }

  function handleClear() {
    onPathsFound([]);
    setResultCount(null);
    setError(null);
  }

  return (
    <div className="absolute bottom-14 right-4 z-20 w-72 bg-background/95 backdrop-blur-sm border border-border rounded-lg shadow-lg">
      {/* Header / toggle */}
      <button
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span className="flex items-center gap-1.5">
          <GitBranch className="w-3.5 h-3.5" />
          Path Query
          {resultCount !== null && (
            <span className={cn(
              "ml-1 px-1.5 rounded text-xs",
              resultCount > 0 ? "bg-green-500/20 text-green-400" : "bg-muted text-muted-foreground"
            )}>
              {resultCount} path{resultCount !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
      </button>

      {expanded && (
        <form onSubmit={handleSubmit} className="px-3 pb-3 space-y-3 border-t border-border pt-3">
          {/* Source node */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">From node</Label>
            <NodeAutocomplete
              nodes={nodes}
              value={sourceNode}
              onChange={setSourceNode}
              placeholder="Search source node…"
            />
          </div>

          {/* Target mode */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Target</Label>
            <RadioGroup
              value={targetMode}
              onValueChange={(v) => setTargetMode(v as 'kind' | 'node')}
              className="flex items-center gap-3"
            >
              <div className="flex items-center gap-1">
                <RadioGroupItem value="kind" id="target-kind" className="h-3 w-3" />
                <Label htmlFor="target-kind" className="text-xs">By kind</Label>
              </div>
              <div className="flex items-center gap-1">
                <RadioGroupItem value="node" id="target-node" className="h-3 w-3" />
                <Label htmlFor="target-node" className="text-xs">By node</Label>
              </div>
            </RadioGroup>
          </div>

          {targetMode === 'kind' ? (
            <Select value={targetKind} onValueChange={setTargetKind}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Select node kind…" />
              </SelectTrigger>
              <SelectContent>
                {NODE_KINDS.map(k => (
                  <SelectItem key={k} value={k} className="text-xs">{k}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <NodeAutocomplete
              nodes={nodes}
              value={targetNode}
              onChange={setTargetNode}
              placeholder="Search target node…"
            />
          )}

          {/* Max depth */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Max depth: <span className="text-foreground font-medium">{maxDepth}</span>
            </Label>
            <Slider
              min={1}
              max={10}
              step={1}
              value={[maxDepth]}
              onValueChange={([v]) => setMaxDepth(v)}
              className="w-full"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}

          {/* No paths result */}
          {resultCount === 0 && !error && (
            <p className="text-xs text-muted-foreground">
              No paths found within {maxDepth} hops.
            </p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              className="h-7 text-xs flex-1"
              disabled={!canSubmit || loading}
            >
              {loading ? 'Querying…' : 'Find paths'}
            </Button>
            {resultCount !== null && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                onClick={handleClear}
                title="Clear highlights"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
