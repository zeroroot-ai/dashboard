'use client';

import { Bot, Search, Zap, Activity, Shield, Plus, Trash2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import type { Conversation, ChatAgent } from '@/src/stores/chat-store';

// ============================================================================
// Types
// ============================================================================

export interface ConversationListProps {
  conversations: Conversation[];
  activeId: string | null;
  agents: ChatAgent[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
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

// ============================================================================
// Component
// ============================================================================

export function ConversationList({
  conversations,
  activeId,
  agents,
  onSelect,
  onNew,
  onDelete,
}: ConversationListProps) {
  const sorted = [...conversations].sort(
    (a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button onClick={onNew} className="w-full" variant="outline" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          New Chat
        </Button>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {sorted.length === 0 && (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              No conversations yet
            </p>
          )}
          {sorted.map((conv) => {
            const agent = agents.find((a) => a.id === conv.agentId);
            const AgentIcon = getAgentIcon(agent?.icon);
            const isActive = conv.id === activeId;
            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv.id)}
                className={`group flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <AgentIcon className="h-4 w-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{conv.title || 'New Chat'}</p>
                  <p className="text-muted-foreground truncate text-xs">
                    {formatRelativeTime(conv.lastMessageAt)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(conv.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatRelativeTime(date: Date | string): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(date).toLocaleDateString();
}
