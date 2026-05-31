'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat as useAIChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  MessagePrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  MessagePartPrimitive,
  useMessage,
  type TextMessagePartProps,
} from '@assistant-ui/react';
import { useAISDKRuntime } from '@assistant-ui/react-ai-sdk';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';
import { MermaidBlock } from '@/components/gibson/chat/MermaidBlock';
import { toast } from 'sonner';
import {
  Bot,
  Bug,
  Search,
  Zap,
  Activity,
  Shield,
  Plus,
  Trash2,
  Send,
  Square,
  PanelLeftClose,
  PanelLeftOpen,
  Copy,
  RefreshCw,
  X,
  MessageSquare,
  ChevronDown,
  Paperclip,
  Loader2,
  Pin,
  PinOff,
  Pencil,
  Check,
  Download,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  useChatStore,
  useSelectedAgent,
  useChatGraphContext,
} from '@/src/stores/chat-store';
import type { Conversation, ChatAgent, GraphContext } from '@/src/stores/chat-store';
import { renameConversation, deleteConversationAction, saveConversationAction } from '@/app/actions/chat';
import type { GraphSummaryResponse } from '@/src/lib/graph/summary';
import { SystemPromptDebugPanel } from '@/components/gibson/chat/SystemPromptDebugPanel';
import { GraphCitationChip } from './GraphCitationChip';
import {
  conversationToMarkdown,
  conversationToPlaintext,
  downloadText,
  titleToFilename,
} from '@/src/lib/chat/export';

// ============================================================================
// Agent icon mapping
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

function agentStatusClass(status: ChatAgent['status']): string {
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
// Search excerpt highlighting — no dangerouslySetInnerHTML
// ============================================================================

interface HighlightedTextProps {
  text: string;
  query: string;
}

function HighlightedText({ text, query }: HighlightedTextProps) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const idx = lower.indexOf(lowerQuery);
  if (idx === -1) return <>{text}</>;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + query.length);
  const after = text.slice(idx + query.length);
  return (
    <>
      {before}
      <span className="text-highlight font-medium">{match}</span>
      {after}
    </>
  );
}

// ============================================================================
// Conversation list sidebar
// ============================================================================

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  agents: ChatAgent[];
  pinnedIds: string[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}

/** Extract the first text content from a UIMessage's parts array. */
function getMessageText(msg: Conversation['messages'][number]): string {
  for (const part of msg.parts) {
    if (part.type === 'text') return part.text;
  }
  return '';
}

function ConversationSidebar({
  conversations,
  activeId,
  agents,
  pinnedIds,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onTogglePin,
  searchRef,
}: ConversationSidebarProps) {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const pinnedSet = new Set(pinnedIds);

  const sorted = [...conversations].sort((a, b) => {
    const aPin = pinnedSet.has(a.id) ? 1 : 0;
    const bPin = pinnedSet.has(b.id) ? 1 : 0;
    if (bPin !== aPin) return bPin - aPin;
    return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
  });

  interface FilteredConversation {
    conv: Conversation;
    excerpt: string | null;
  }

  const filtered: FilteredConversation[] = query
    ? sorted.reduce<FilteredConversation[]>((acc, conv) => {
        const lowerQuery = query.toLowerCase();
        const titleMatch = (conv.title ?? '').toLowerCase().includes(lowerQuery);
        if (titleMatch) {
          acc.push({ conv, excerpt: null });
          return acc;
        }
        for (const msg of conv.messages) {
          const text = getMessageText(msg);
          if (text.toLowerCase().includes(lowerQuery)) {
            acc.push({ conv, excerpt: text.slice(0, 80) });
            return acc;
          }
        }
        return acc;
      }, [])
    : sorted.map((conv) => ({ conv, excerpt: null }));

  const startRename = useCallback((conv: Conversation) => {
    setEditingId(conv.id);
    setEditValue(conv.title || '');
    // Focus after render
    setTimeout(() => editInputRef.current?.select(), 0);
  }, []);

  const commitRename = useCallback(
    (id: string) => {
      const trimmed = editValue.trim();
      if (trimmed) onRename(id, trimmed);
      setEditingId(null);
    },
    [editValue, onRename],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 p-3">
        <Button onClick={onNew} className="w-full" variant="outline" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          New Chat
        </Button>
        <div className="relative">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search conversations..."
            className="h-8 pl-8 pr-8 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-muted-foreground hover:text-foreground absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 p-2">
          {filtered.length === 0 && (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">
              {query ? 'No matching conversations' : 'No conversations yet'}
            </p>
          )}
          {filtered.map(({ conv, excerpt }) => {
            const agent = agents.find((a) => a.id === conv.agentId);
            const AgentIcon = getAgentIcon(agent?.icon);
            const isActive = conv.id === activeId;
            const isPinned = pinnedSet.has(conv.id);
            const isEditing = editingId === conv.id;

            return (
              <div
                key={conv.id}
                className={`group relative flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => !isEditing && onSelect(conv.id)}
                >
                  <AgentIcon className="h-4 w-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onBlur={() => commitRename(conv.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename(conv.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="bg-background border-input w-full rounded border px-1 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                        data-testid="conversation-rename-input"
                      />
                    ) : (
                      <>
                        <p className="flex items-center gap-1 truncate font-medium">
                          {isPinned && (
                            <Pin className="text-highlight h-2.5 w-2.5 shrink-0" aria-label="Pinned" />
                          )}
                          {query ? (
                            <HighlightedText text={conv.title || 'New Chat'} query={query} />
                          ) : (
                            conv.title || 'New Chat'
                          )}
                        </p>
                        {excerpt ? (
                          <p className="text-muted-foreground truncate text-xs">
                            <HighlightedText text={excerpt} query={query} />
                          </p>
                        ) : (
                          <p className="text-muted-foreground truncate text-xs">
                            {formatRelativeTime(conv.lastMessageAt)}
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </button>

                {/* Hover action buttons */}
                {!isEditing && (
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        onTogglePin(conv.id);
                      }}
                      aria-label={isPinned ? 'Unpin conversation' : 'Pin conversation'}
                    >
                      {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        startRename(conv);
                      }}
                      aria-label="Rename conversation"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(conv.id);
                      }}
                      aria-label="Delete conversation"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                {isEditing && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      commitRename(conv.id);
                    }}
                    aria-label="Save rename"
                  >
                    <Check className="h-3 w-3" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

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

// ============================================================================
// Agent selector
// ============================================================================

interface AgentSelectorProps {
  agents: ChatAgent[];
  selectedId: string;
  onSelect: (agentId: string) => void;
}

function AgentSelector({ agents, selectedId, onSelect }: AgentSelectorProps) {
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];
  if (!selected) return null;
  const SelectedIcon = getAgentIcon(selected.icon);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <SelectedIcon className="h-4 w-4" />
          <span>{selected.name}</span>
          <span className={`h-2 w-2 rounded-full ${agentStatusClass(selected.status)}`} />
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
                  <span className={`h-2 w-2 rounded-full ${agentStatusClass(agent.status)}`} />
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

// ============================================================================
// Graph context badge
// ============================================================================

interface GraphContextBadgeProps {
  context: GraphContext;
  onDismiss: () => void;
}

function GraphContextBadge({ context, onDismiss }: GraphContextBadgeProps) {
  const label = context.nodeLabel || context.nodeId || 'Unknown';
  const type = context.nodeType || 'Node';
  return (
    <Badge variant="secondary" className="gap-1">
      {type}: {label}
      <button
        onClick={onDismiss}
        className="ml-1 rounded-sm hover:opacity-70"
        aria-label="Clear graph context"
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}

// ============================================================================
// Welcome state
// ============================================================================

const SUGGESTED_PROMPTS = [
  'Summarize my latest mission findings',
  'What hosts have critical vulnerabilities?',
  'Show me the attack surface overview',
  'What did the last scan discover?',
];

interface WelcomeStateProps {
  agent: ChatAgent | undefined;
  graphSummary: GraphSummaryResponse | null;
  onSendPrompt: (text: string) => void;
}

function WelcomeState({ agent, graphSummary, onSendPrompt }: WelcomeStateProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-lg text-center">
        <div className="bg-primary/10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
          <MessageSquare className="text-primary h-8 w-8" />
        </div>
        <h2 className="mb-2 text-xl font-semibold">
          Chat with {agent?.name || 'Zero Day AI'}
        </h2>
        <p className="text-muted-foreground mb-1 text-sm">
          {agent?.description || 'AI-powered security assistant'}
        </p>
        {graphSummary && graphSummary.stats.hosts > 0 && (
          <p className="text-muted-foreground mb-4 text-xs">
            Your knowledge graph has {graphSummary.stats.hosts} hosts,{' '}
            {graphSummary.stats.findings} findings, and{' '}
            {graphSummary.stats.missions} missions.
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => onSendPrompt(prompt)}
              className="border-border text-muted-foreground hover:bg-muted hover:text-foreground rounded-md border px-3 py-1.5 text-sm transition-colors"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Mermaid syntax highlighter for MarkdownTextPrimitive
// ============================================================================

/**
 * Renders a ```mermaid code block as a live diagram via MermaidBlock.
 * Passed to MarkdownTextPrimitive via componentsByLanguage.
 */
function MermaidSyntaxHighlighter({ code }: SyntaxHighlighterProps) {
  return <MermaidBlock code={code} />;
}

const MARKDOWN_COMPONENTS_BY_LANGUAGE = {
  mermaid: { SyntaxHighlighter: MermaidSyntaxHighlighter },
} as const;

// ============================================================================
// Citation marker utilities
// ============================================================================

const CITATION_MARKER_RE = /\[cite:node:[^\]]+\]/g;

/** Strip all [cite:node:...] markers from a text string before markdown rendering. */
function stripCitationMarkers(text: string): string {
  return text.replace(CITATION_MARKER_RE, '').trimEnd();
}

/** Extract unique node IDs from citation markers in a text string. */
function extractCitedNodeIds(text: string): string[] {
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const re = /\[cite:node:([^\]]+)\]/g;
  while ((match = re.exec(text)) !== null) {
    ids.add(match[1]);
  }
  return Array.from(ids);
}

// ============================================================================
// Message part components
// ============================================================================

/**
 * Renders an assistant text part as markdown.
 * Uses preprocess to strip citation markers before rendering (the markers
 * are surfaced as chips at the message level) and componentsByLanguage for
 * live Mermaid diagram rendering.
 */
function AssistantTextPart(_props: TextMessagePartProps) {
  return (
    <>
      <MarkdownTextPrimitive
        className="prose prose-sm dark:prose-invert max-w-none"
        componentsByLanguage={MARKDOWN_COMPONENTS_BY_LANGUAGE}
        preprocess={stripCitationMarkers}
      />
      {/* Streaming dots — shown on this text part while it is still being
          generated. MessagePartPrimitive.InProgress reads the `part` scope,
          which only exists inside a part component (the one passed to
          MessagePrimitive.Parts). Rendering it at the message level throws
          'The current scope does not have a "part" property'. */}
      <MessagePartPrimitive.InProgress>
        <span className="ml-1 inline-flex items-center gap-1">
          <span className="bg-muted-foreground h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:0ms]" />
          <span className="bg-muted-foreground h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:150ms]" />
          <span className="bg-muted-foreground h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:300ms]" />
        </span>
      </MessagePartPrimitive.InProgress>
    </>
  );
}

/** Renders a user text part as plain text. */
function UserTextPart({ text }: TextMessagePartProps) {
  return <span>{text}</span>;
}

// ============================================================================
// Message components
// ============================================================================

export function UserMessage() {
  return (
    <MessagePrimitive.Root className="mb-4 flex flex-row-reverse items-end gap-2">
      <div className="bg-primary text-primary-foreground max-w-[80%] rounded-lg px-4 py-2 text-sm">
        <MessagePrimitive.Parts components={{ Text: UserTextPart }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessageCitations() {
  const { graphContext } = useChatGraphContext();
  const content = useMessage((state) => state.content);

  // Only surface citations when a focused graph node is active
  if (!graphContext?.nodeId) return null;

  const fullText = content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');

  const nodeIds = extractCitedNodeIds(fullText);
  if (nodeIds.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {nodeIds.map((id) => (
        <GraphCitationChip key={id} nodeId={id} />
      ))}
    </div>
  );
}

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group/message mb-4 flex items-end gap-2">
      <div className="bg-secondary text-secondary-foreground max-w-[80%] rounded-lg px-4 py-2 text-sm">
        <MessagePrimitive.Parts components={{ Text: AssistantTextPart }} />
        {/* Citation chips — rendered below the message body when the model
            cited data from a focused knowledge-graph node */}
        <AssistantMessageCitations />
      </div>
      {/* Action bar — copy + regenerate; hidden while running or on non-last messages */}
      <ActionBarPrimitive.Root
        hideWhenRunning
        autohide="not-last"
        className="flex items-center gap-1 opacity-0 transition-opacity group-hover/message:opacity-100"
      >
        <ActionBarPrimitive.Copy asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <Copy className="h-3 w-3" />
            <span className="sr-only">Copy</span>
          </Button>
        </ActionBarPrimitive.Copy>
        <ActionBarPrimitive.Reload asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6">
            <RefreshCw className="h-3 w-3" />
            <span className="sr-only">Regenerate</span>
          </Button>
        </ActionBarPrimitive.Reload>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

// ============================================================================
// Composer (input area)
// ============================================================================

interface AttachmentState {
  /** Server-issued id; null until upload completes. */
  id: string | null;
  /** Original filename, kept for the chip label. */
  filename: string;
}

interface ChatComposerProps {
  placeholder: string;
  attachment: AttachmentState | null;
  attachmentUploading: boolean;
  onAttachFile: (file: File) => void;
  onClearAttachment: () => void;
}

function ChatComposer({
  placeholder,
  attachment,
  attachmentUploading,
  onAttachFile,
  onClearAttachment,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePaperclipClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onAttachFile(file);
      // Reset so the same file can be re-selected if the user clears + re-picks.
      e.target.value = '';
    },
    [onAttachFile],
  );

  return (
    <ComposerPrimitive.Root className="border-input bg-background flex flex-col gap-2 rounded-2xl border p-2 shadow-xs">
      {/* Attachment chip — sits above the textarea while a file is staged */}
      {(attachment || attachmentUploading) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <Badge variant="secondary" className="gap-1.5">
            {attachmentUploading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Paperclip className="h-3 w-3" />
            )}
            <span className="max-w-[16rem] truncate">
              {attachment?.filename ?? 'Uploading…'}
            </span>
            {!attachmentUploading && (
              <button
                type="button"
                onClick={onClearAttachment}
                className="ml-1 rounded-sm hover:opacity-70"
                aria-label="Remove attachment"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        </div>
      )}
      <div className="flex items-end gap-2">
        {/* Hidden native input; the paperclip button proxies clicks */}
        <input
          ref={fileInputRef}
          type="file"
          accept="text/*,application/json,application/pdf"
          className="hidden"
          onChange={handleFileChange}
          data-testid="chat-attachment-input"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handlePaperclipClick}
          disabled={attachmentUploading}
          aria-label="Attach file"
        >
          {attachmentUploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Paperclip className="h-4 w-4" />
          )}
        </Button>
        {/* ComposerPrimitive.Input handles ⌘+Enter to send and Escape to cancel */}
        <ComposerPrimitive.Input
          autoFocus
          placeholder={placeholder}
          rows={1}
          className="min-h-[44px] flex-1 resize-none border-none bg-transparent text-sm shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {/* Send — automatically disabled when thread is running */}
        <ComposerPrimitive.Send asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <Send className="h-4 w-4" />
            <span className="sr-only">Send message</span>
          </Button>
        </ComposerPrimitive.Send>
        {/* Cancel — automatically disabled when thread is not running */}
        <ComposerPrimitive.Cancel asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
            <Square className="h-4 w-4" />
            <span className="sr-only">Stop generating</span>
          </Button>
        </ComposerPrimitive.Cancel>
      </div>
    </ComposerPrimitive.Root>
  );
}

// ============================================================================
// ChatContent — root component
// ============================================================================

export function ChatContent() {
  const {
    conversations,
    activeConversationId,
    pinnedConversationIds,
    agents,
    selectedAgentId,
    setAgents,
    setSelectedAgent,
    setActiveConversation,
    createConversation,
    deleteConversation,
    finalizePartialMessage,
    setConnectionStatus,
    setLastError,
    togglePinConversation,
    updateConversationTitle,
  } = useChatStore();

  const selectedAgent = useSelectedAgent();
  const { graphContext, clearGraphContext } = useChatGraphContext();

  const [graphSummary, setGraphSummary] = useState<GraphSummaryResponse | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [attachment, setAttachment] = useState<AttachmentState | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);

  const { setSystemPromptDebug } = useChatStore();

  const activeConvRef = useRef(activeConversationId);
  activeConvRef.current = activeConversationId;

  // Ref for the sidebar search input — used by the ⌘+F / Ctrl+F shortcut
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keep the latest attachmentId reachable from the transport closure without
  // re-instantiating the transport on every render.
  const attachmentIdRef = useRef<string | null>(null);
  attachmentIdRef.current = attachment?.id ?? null;

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  // Keep a stable ref to setSystemPromptDebug so the fetch closure doesn't
  // need to be recreated on every render.
  const setDebugRef = useRef(setSystemPromptDebug);
  setDebugRef.current = setSystemPromptDebug;

  // Transport — recreated only when the debug flag changes. The body callback
  // and fetch wrapper read the latest attachment / debug state from refs so we
  // don't churn the transport on every render.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        headers: isDebugOpen ? { 'X-Gibson-Debug': '1' } : undefined,
        body: () => {
          const id = attachmentIdRef.current;
          return id ? { attachmentId: id } : {};
        },
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          const debugPayload = response.headers.get('X-Gibson-System-Prompt-Debug');
          if (debugPayload) {
            setDebugRef.current(decodeURIComponent(debugPayload));
          }
          return response;
        },
      }),
    [isDebugOpen],
  );

  // Wire to AI SDK useChat — assistant-ui wraps this via useAISDKRuntime
  const aiChat = useAIChat({
    id: activeConversationId || undefined,
    messages: activeConversation?.messages,
    transport,
    onError: (err) => {
      setConnectionStatus('error');
      setLastError(err.message);
      if (err.message.includes('503') || err.message.toLowerCase().includes('provider')) {
        setProviderError(
          'No LLM provider configured. Go to Settings > Providers to set up your API key.',
        );
      }
    },
    onFinish: () => {
      setConnectionStatus('connected');
      setLastError(null);
      // Attachments are single-use; clear once the message round-trip finishes.
      setAttachment(null);
    },
  });

  const { messages, status, setMessages } = aiChat;

  // Persist messages to Zustand (and daemon) when streaming completes.
  // This fires on BOTH natural completion and user-initiated stop: the AI SDK
  // transitions status streaming → ready in both cases with the partial (or
  // full) assistant message already materialized in the messages array.
  // `finalizePartialMessage` and `saveMessages` share the same replacement
  // semantics (atomic full-list write) so either path is idempotent and
  // produces exactly one consistent record — no dangling or duplicate message.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === 'streaming' && status === 'ready') {
      const convId = activeConvRef.current;
      if (convId && messages.length > 0) {
        // Write to Zustand — finalizePartialMessage covers both the stop case
        // and natural-completion case with the same atomic replacement semantics.
        finalizePartialMessage(convId, messages);

        // Persist to the daemon conversation store so the partial (or full)
        // response survives reload. Fire-and-forget: RPC failures degrade
        // silently; the conversation remains in Zustand for the current session.
        const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
        if (conv) {
          void saveConversationAction(
            convId,
            conv.title ?? `Conversation ${convId}`,
            messages,
            conv.agentId,
          );
        }
      }
    }
    prevStatusRef.current = status;
  }, [status, messages, finalizePartialMessage]);

  // Update connection status
  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') {
      setConnectionStatus('connected');
    }
  }, [status, setConnectionStatus]);

  // Clear provider error on successful completion
  useEffect(() => {
    if (status === 'ready' && messages.length > 0) {
      setProviderError(null);
    }
  }, [status, messages.length]);

  // Build the assistant-ui runtime from the AI SDK chat helpers
  const runtime = useAISDKRuntime(aiChat);

  // Agents come from the static store defaults; no remote fetch needed
  // (the /api/chat/agents route was removed when personas replaced agents).

  // Fetch graph summary on mount
  useEffect(() => {
    async function fetchSummary() {
      try {
        const res = await fetch('/api/chat/graph-summary');
        if (res.ok) {
          const data: GraphSummaryResponse = await res.json();
          setGraphSummary(data);
        }
      } catch {
        // Proceed without graph summary
      }
    }
    fetchSummary();
  }, []);

  // ⌘+F / Ctrl+F focuses the sidebar search input when focus is not already
  // in a text field. Prevents interfering with native browser find-in-page when
  // the user is already typing in a chat input or textarea.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        const target = e.target as HTMLElement;
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Handlers
  const handleNewConversation = useCallback(() => {
    const newId = createConversation(selectedAgentId, graphContext || undefined);
    setActiveConversation(newId);
    setMessages([]);
  }, [createConversation, selectedAgentId, graphContext, setActiveConversation, setMessages]);

  const handleSwitchConversation = useCallback(
    (id: string) => {
      const conv = conversations.find((c) => c.id === id);
      if (conv) {
        setActiveConversation(id);
        setMessages(conv.messages);
      }
    },
    [conversations, setActiveConversation, setMessages],
  );

  const handleSelectAgent = useCallback(
    (agentId: string) => {
      setSelectedAgent(agentId);
      const newId = createConversation(agentId, graphContext || undefined);
      setActiveConversation(newId);
      setMessages([]);
    },
    [setSelectedAgent, createConversation, graphContext, setActiveConversation, setMessages],
  );

  const handleAttachFile = useCallback(async (file: File) => {
    setAttachmentUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/chat/attachment', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        let message = `Upload failed (${res.status})`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          // Non-JSON error body; keep the generic message.
        }
        toast.error(message);
        return;
      }
      const data = (await res.json()) as { attachmentId: string };
      setAttachment({ id: data.attachmentId, filename: file.name });
    } catch {
      toast.error('Could not upload the attachment.');
    } finally {
      setAttachmentUploading(false);
    }
  }, []);

  const handleClearAttachment = useCallback(() => {
    setAttachment(null);
  }, []);

  const handleRename = useCallback(
    (id: string, title: string) => {
      // Optimistic update — immediately reflected in the store.
      // Persist via daemon RPC; revert on failure.
      const prev = conversations.find((c) => c.id === id)?.title ?? '';
      updateConversationTitle(id, title);
      void renameConversation(id, title).then((ok) => {
        if (!ok) {
          // Revert the optimistic update.
          updateConversationTitle(id, prev);
          toast.error('Could not rename the conversation. Please try again.');
        }
      });
    },
    [updateConversationTitle, conversations],
  );

  const handleDelete = useCallback(
    (id: string) => {
      // Optimistic update — remove from store immediately.
      deleteConversation(id);
      void deleteConversationAction(id).then((ok) => {
        if (!ok) {
          // The daemon rejected the delete. Re-hydrate the store from the
          // daemon would require a full conversation fetch; instead surface
          // an error and let the user reload to restore the list.
          toast.error('Could not delete the conversation. Please refresh to see its current state.');
        }
      });
    },
    [deleteConversation],
  );

  const handleExport = useCallback(
    (format: 'markdown' | 'plaintext') => {
      if (!activeConversation) return;
      const stem = titleToFilename(activeConversation.title || '');
      if (format === 'markdown') {
        downloadText(
          conversationToMarkdown(activeConversation),
          `${stem}.md`,
          'text/markdown;charset=utf-8',
        );
      } else {
        downloadText(
          conversationToPlaintext(activeConversation),
          `${stem}.txt`,
          'text/plain;charset=utf-8',
        );
      }
    },
    [activeConversation],
  );

  // Send a suggested prompt via the runtime
  const handleSuggestion = useCallback(
    (text: string) => {
      if (!activeConvRef.current) {
        const newId = createConversation(selectedAgentId, graphContext || undefined);
        setActiveConversation(newId);
      }
      setProviderError(null);
      runtime.thread.append(text);
    },
    [runtime, createConversation, selectedAgentId, graphContext, setActiveConversation],
  );

  const sidebarContent = (
    <ConversationSidebar
      conversations={conversations}
      activeId={activeConversationId}
      agents={agents}
      pinnedIds={pinnedConversationIds}
      onSelect={handleSwitchConversation}
      onNew={handleNewConversation}
      onDelete={handleDelete}
      onRename={handleRename}
      onTogglePin={togglePinConversation}
      searchRef={searchInputRef}
    />
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-[var(--content-full-height)]">
        {/* Desktop conversation sidebar */}
        {sidebarOpen && (
          <div className="hidden w-72 shrink-0 border-r lg:block">{sidebarContent}</div>
        )}

        {/* Main chat area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center gap-2 border-b px-4 py-2">
            {/* Mobile: sheet trigger */}
            <div className="lg:hidden">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <PanelLeftOpen className="h-4 w-4" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-72 p-0">
                  <SheetHeader className="sr-only">
                    <SheetTitle>Conversations</SheetTitle>
                  </SheetHeader>
                  {sidebarContent}
                </SheetContent>
              </Sheet>
            </div>

            {/* Desktop: sidebar toggle */}
            <div className="hidden lg:block">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setSidebarOpen((v) => !v)}
              >
                {sidebarOpen ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeftOpen className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Agent selector */}
            <AgentSelector
              agents={agents}
              selectedId={selectedAgentId}
              onSelect={handleSelectAgent}
            />

            <div className="flex-1" />

            {/* Graph context badge */}
            {graphContext && (
              <GraphContextBadge context={graphContext} onDismiss={clearGraphContext} />
            )}

            {/* Export conversation */}
            {activeConversation && activeConversation.messages.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Export conversation">
                    <Download className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Export as</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => handleExport('markdown')}>
                    Markdown (.md)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport('plaintext')}>
                    Plain text (.txt)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Debug panel toggle */}
            <Button
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${isDebugOpen ? 'text-highlight' : ''}`}
              onClick={() => setIsDebugOpen((v) => !v)}
              aria-label="Toggle system prompt debug panel"
              aria-pressed={isDebugOpen}
            >
              <Bug className="h-4 w-4" />
            </Button>
          </div>

          {/* Debug panel — rendered below header, above message area */}
          {isDebugOpen && <SystemPromptDebugPanel />}

          {/* Messages area */}
          <div className="relative flex-1 overflow-hidden">
            {/* Welcome state when thread is empty */}
            <ThreadPrimitive.If empty>
              <WelcomeState
                agent={selectedAgent}
                graphSummary={graphSummary}
                onSendPrompt={handleSuggestion}
              />
            </ThreadPrimitive.If>

            {/* Message list */}
            <ThreadPrimitive.If empty={false}>
              <ThreadPrimitive.Viewport className="h-full overflow-y-auto px-4 py-4">
                <ThreadPrimitive.Messages
                  components={{
                    UserMessage,
                    AssistantMessage,
                  }}
                />
                {/* Scroll-to-bottom button */}
                <ThreadPrimitive.ScrollToBottom asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="absolute bottom-4 left-1/2 h-8 w-8 -translate-x-1/2 rounded-full"
                  >
                    <ChevronDown className="h-4 w-4" />
                    <span className="sr-only">Scroll to bottom</span>
                  </Button>
                </ThreadPrimitive.ScrollToBottom>
              </ThreadPrimitive.Viewport>
            </ThreadPrimitive.If>
          </div>

          {/* Provider error banner */}
          {providerError && (
            <div className="border-t border-alt/40 bg-alt/10 px-4 py-2 text-sm text-alt">
              {providerError}
            </div>
          )}

          {/* Input area */}
          <div className="border-t p-4">
            <ChatComposer
              placeholder={`Message ${selectedAgent?.name || 'Zero Day AI'}...`}
              attachment={attachment}
              attachmentUploading={attachmentUploading}
              onAttachFile={handleAttachFile}
              onClearAttachment={handleClearAttachment}
            />
          </div>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
