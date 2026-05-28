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
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import type { GraphSummaryResponse } from '@/src/lib/graph/summary';
import { SystemPromptDebugPanel } from '@/components/gibson/chat/SystemPromptDebugPanel';
import { GraphCitationChip } from './GraphCitationChip';

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
// Conversation list sidebar
// ============================================================================

interface ConversationSidebarProps {
  conversations: Conversation[];
  activeId: string | null;
  agents: ChatAgent[];
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

function ConversationSidebar({
  conversations,
  activeId,
  agents,
  onSelect,
  onNew,
  onDelete,
}: ConversationSidebarProps) {
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
    <MarkdownTextPrimitive
      className="prose prose-sm dark:prose-invert max-w-none"
      componentsByLanguage={MARKDOWN_COMPONENTS_BY_LANGUAGE}
      preprocess={stripCitationMarkers}
    />
  );
}

/** Renders a user text part as plain text. */
function UserTextPart({ text }: TextMessagePartProps) {
  return <span>{text}</span>;
}

// ============================================================================
// Message components
// ============================================================================

function UserMessage() {
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

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="group/message mb-4 flex items-end gap-2">
      <div className="bg-secondary text-secondary-foreground max-w-[80%] rounded-lg px-4 py-2 text-sm">
        <MessagePrimitive.Parts components={{ Text: AssistantTextPart }} />
        {/* Streaming dots — shown on the last text part while generating */}
        <MessagePartPrimitive.InProgress>
          <span className="ml-1 inline-flex items-center gap-1">
            <span className="bg-muted-foreground h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:0ms]" />
            <span className="bg-muted-foreground h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:150ms]" />
            <span className="bg-muted-foreground h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:300ms]" />
          </span>
        </MessagePartPrimitive.InProgress>
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
    agents,
    selectedAgentId,
    setAgents,
    setSelectedAgent,
    setActiveConversation,
    createConversation,
    deleteConversation,
    saveMessages,
    setConnectionStatus,
    setLastError,
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

  // Persist messages to Zustand when streaming completes
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === 'streaming' && status === 'ready') {
      if (activeConvRef.current && messages.length > 0) {
        saveMessages(activeConvRef.current, messages);
      }
    }
    prevStatusRef.current = status;
  }, [status, messages, saveMessages]);

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

  // Fetch agents on mount
  useEffect(() => {
    async function fetchAgents() {
      try {
        const res = await fetch('/api/chat/agents');
        if (res.ok) {
          const data = await res.json();
          if (data.agents?.length > 0) {
            setAgents(data.agents);
          }
        }
      } catch {
        // Fall back to default agents in store
      }
    }
    fetchAgents();
  }, [setAgents]);

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
      onSelect={handleSwitchConversation}
      onNew={handleNewConversation}
      onDelete={(id) => deleteConversation(id)}
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
