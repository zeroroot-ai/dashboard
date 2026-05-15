'use client';

import { Bot, Search, Zap, Activity, Shield } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ChatAgent } from '@/src/stores/chat-store';

// ============================================================================
// Types
// ============================================================================

export interface AgentSelectorProps {
  agents: ChatAgent[];
  selectedId: string;
  onSelect: (agentId: string) => void;
}

// ============================================================================
// Icon mapping
// ============================================================================

const AGENT_ICONS: Record<string, LucideIcon> = {
  bot: Bot,
  search: Search,
  zap: Zap,
  activity: Activity,
  shield: Shield,
};

function getAgentIcon(iconName?: string): LucideIcon {
  return AGENT_ICONS[iconName ?? 'bot'] ?? Bot;
}

function statusColor(status: ChatAgent['status']): string {
  switch (status) {
    case 'online':
      return 'bg-highlight';
    case 'busy':
      return 'bg-alt';
    case 'offline':
      return 'bg-destructive';
    default:
      return 'bg-muted';
  }
}

// ============================================================================
// Component
// ============================================================================

export function AgentSelector({ agents, selectedId, onSelect }: AgentSelectorProps) {
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];
  if (!selected) return null;

  const SelectedIcon = getAgentIcon(selected.icon);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <SelectedIcon className="h-4 w-4" />
          <span>{selected.name}</span>
          <span className={`h-2 w-2 rounded-full ${statusColor(selected.status)}`} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Select Agent</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {agents.map((agent) => {
          const Icon = getAgentIcon(agent.icon);
          return (
            <DropdownMenuItem
              key={agent.id}
              onClick={() => onSelect(agent.id)}
              className="flex items-start gap-3 py-2"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{agent.name}</span>
                  <span className={`h-2 w-2 rounded-full ${statusColor(agent.status)}`} />
                </div>
                <p className="text-muted-foreground text-xs">{agent.description}</p>
              </div>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
