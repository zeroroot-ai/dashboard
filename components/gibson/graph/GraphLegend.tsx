'use client';

/**
 * GraphLegend
 *
 * Overlay key mapping the node entity types and edge relationship types present
 * in the current graph to their colors/icons. Derived from the data, so it only
 * lists what's actually on screen. Colors come from `src/lib/graph` (canvas
 * palette); swatches use inline style with those values, `components/**` stays
 * free of hardcoded color literals.
 */

import {
  Rocket, Play, Bot, Wrench, Sparkles, Globe, Server, Plug, Cog, Link as LinkIcon,
  Cpu, Shield, Bug, FileText, Crosshair, Circle, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getEntityColor, getSeverityColor, type EntityType } from '@/src/lib/graph/entity-taxonomy';
import { getThemeColors } from '@/src/lib/graph/theme-colors';
import { EDGE_FALLBACK } from '@/src/lib/graph/canvas-style';
import { SEVERITY_LEVELS } from '@/src/lib/graph/severity';

const ENTITY_ICONS: Record<string, LucideIcon> = {
  mission: Rocket,
  mission_run: Play,
  agent_run: Bot,
  tool_execution: Wrench,
  llm_call: Sparkles,
  domain: Globe,
  subdomain: Globe,
  host: Server,
  port: Plug,
  service: Cog,
  endpoint: LinkIcon,
  technology: Cpu,
  certificate: Shield,
  finding: Bug,
  evidence: FileText,
  technique: Crosshair,
};

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface GraphLegendProps {
  nodeTypes: string[];
  relationshipTypes: string[];
  /** Show the finding-severity scale (when the severity heatmap is on). */
  showSeverityScale?: boolean;
  className?: string;
}

export function GraphLegend({
  nodeTypes,
  relationshipTypes,
  showSeverityScale,
  className,
}: GraphLegendProps) {
  const theme = getThemeColors();
  if (nodeTypes.length === 0 && relationshipTypes.length === 0 && !showSeverityScale) return null;

  return (
    <div
      className={cn(
        'absolute z-20 bottom-14 left-4 max-h-[45%] w-52 overflow-y-auto rounded-lg',
        'bg-background/90 backdrop-blur-md border border-border p-3 text-xs',
        className
      )}
      aria-label="Graph legend"
    >
      {nodeTypes.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Nodes</span>
          {nodeTypes.map((t) => {
            const Icon = ENTITY_ICONS[t] ?? Circle;
            const color = getEntityColor(t as EntityType);
            return (
              <div key={t} className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <Icon className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="text-foreground truncate">{titleCase(t)}</span>
              </div>
            );
          })}
        </div>
      )}

      {relationshipTypes.length > 0 && (
        <div className="flex flex-col gap-1.5 mt-3">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Edges</span>
          {relationshipTypes.map((t) => {
            const color = theme.edgeColors[t as keyof typeof theme.edgeColors] || EDGE_FALLBACK;
            return (
              <div key={t} className="flex items-center gap-2">
                <span
                  className="inline-block w-5 h-0.5 rounded flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <span className="text-foreground truncate">{titleCase(t.toLowerCase())}</span>
              </div>
            );
          })}
        </div>
      )}

      {showSeverityScale && (
        <div className="flex flex-col gap-1.5 mt-3">
          <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Severity</span>
          {SEVERITY_LEVELS.map((sev) => (
            <div key={sev} className="flex items-center gap-2">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: getSeverityColor(sev) }}
              />
              <span className="text-foreground capitalize">{sev}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default GraphLegend;
