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
import { MermaidBlock } from './MermaidBlock';
import {
  Bot,
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
  ThumbsUp,
  ThumbsDown,
  X,
  MessageSquare,
  ChevronDown,
  Crosshair,
  Briefcase,
  Monitor,
  Code,
  ClipboardCheck,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useChatStore,
  useChatGraphContext,
} from '@/src/stores/chat-store';
import type { Conversation, ChatAgent, GraphContext } from '@/src/stores/chat-store';
import { PERSONAS_LIST, getPersona } from '@/src/lib/chat/personas';
import type { Persona } from '@/src/lib/chat/personas';
import type { GraphSummaryResponse } from '@/src/lib/graph/summary';

// ============================================================================
// Agent icon mapping
// ============================================================================

const PERSONA_ICONS: Record<string, LucideIcon> = {
  bot: Bot,
  search: Search,
  zap: Zap,
  activity: Activity,
  shield: Shield,
  crosshair: Crosshair,
  briefcase: Briefcase,
  monitor: Monitor,
  code: Code,
  'clipboard-check': ClipboardCheck,
};

function getPersonaIcon(iconName?: string): LucideIcon {
  return PERSONA_ICONS[iconName ?? 'bot'] ?? Bot;
}

/** @deprecated Use getPersonaIcon — kept for ConversationSidebar which reads ChatAgent.icon */
function getAgentIcon(iconName?: string): LucideIcon {
  return getPersonaIcon(iconName);
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
// Persona selector
// ============================================================================

interface PersonaSelectorProps {
  selectedId: string;
  onSelect: (personaId: string) => void;
}

function PersonaSelector({ selectedId, onSelect }: PersonaSelectorProps) {
  const selected = getPersona(selectedId);
  const SelectedIcon = getPersonaIcon(selected.icon);

  return (
    <TooltipProvider>
      <Select value={selectedId} onValueChange={onSelect}>
        <SelectTrigger size="sm" className="gap-2 border-none bg-transparent shadow-none focus:ring-0 focus-visible:ring-0">
          <SelectValue>
            <span className="flex items-center gap-2">
              <SelectedIcon className="h-4 w-4 shrink-0" />
              <span>{selected.label}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent align="start" className="w-80">
          {PERSONAS_LIST.map((persona) => {
            const Icon = getPersonaIcon(persona.icon);
            return (
              <Tooltip key={persona.id}>
                <TooltipTrigger asChild>
                  <SelectItem value={persona.id} className="py-2.5">
                    <div className="flex items-start gap-3">
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium leading-none">{persona.label}</div>
                        <div className="text-muted-foreground mt-1 text-xs leading-snug">
                          {persona.description}
                        </div>
                      </div>
                    </div>
                  </SelectItem>
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-60">
                  {persona.description}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </SelectContent>
      </Select>
    </TooltipProvider>
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

interface WelcomeStateProps {
  agent: Persona;
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
          Chat with {agent.label}
        </h2>
        <p className="text-muted-foreground mb-1 text-sm">
          {agent.description}
        </p>
        {graphSummary && graphSummary.stats.hosts > 0 && (
          <p className="text-muted-foreground mb-4 text-xs">
            Your knowledge graph has {graphSummary.stats.hosts} hosts,{' '}
            {graphSummary.stats.findings} findings, and{' '}
            {graphSummary.stats.missions} missions.
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {agent.suggestedPrompts.map((prompt) => (
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
// Message part components
// ============================================================================

/**
 * Renders an assistant text part as markdown.
 * MarkdownTextPrimitive reads text from the MessagePartContext established
 * by MessagePrimitive.Parts — no explicit prop-passing required.
 */
const MERMAID_COMPONENTS_BY_LANGUAGE = {
  mermaid: { SyntaxHighlighter: MermaidBlock },
};

function AssistantTextPart(_props: TextMessagePartProps) {
  return (
    <MarkdownTextPrimitive
      className="prose prose-sm dark:prose-invert max-w-none"
      componentsByLanguage={MERMAID_COMPONENTS_BY_LANGUAGE}
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

/**
 * Per-message feedback hook. Reads the message ID from the assistant-ui
 * MessageContext and the streaming `X-Gibson-Trace-Id` from the chat
 * store. Submits to /api/chat/feedback. Optimistic — flips the locally
 * stored rating immediately, then disables both buttons.
 *
 * The traceId flows from the response header into `currentTraceId` via
 * the custom transport `fetch` wrapper in `ChatContent`. When no trace
 * ID is available (e.g. no assistant turn yet), submission is silently
 * suppressed and the buttons stay enabled.
 */
function useFeedback() {
  const messageId = useMessage((s) => s.id);
  const traceId = useChatStore((s) => s.currentTraceId);
  const [rating, setRating] = useState<'up' | 'down' | null>(null);

  const submit = useCallback(
    async (next: 'up' | 'down') => {
      if (rating !== null) return; // single-shot per render
      if (!traceId) return; // no trace to score against
      setRating(next); // optimistic flip
      try {
        await fetch('/api/chat/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messageId, traceId, rating: next }),
        });
      } catch {
        // Network error — keep the optimistic state; a refresh resets it.
        // We deliberately don't surface a toast: feedback is a side
        // affordance and failure shouldn't interrupt the chat flow.
      }
    },
    [messageId, traceId, rating],
  );

  return { rating, submit, disabled: rating !== null || !traceId };
}

function AssistantMessage() {
  const { rating, submit, disabled } = useFeedback();
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
      </div>
      {/* Action bar — copy + regenerate + feedback; hidden while running or on non-last messages */}
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
        <Button
          variant="ghost"
          size="icon"
          className={`h-6 w-6 ${rating === 'up' ? 'text-highlight' : ''}`}
          onClick={() => submit('up')}
          disabled={disabled}
          aria-pressed={rating === 'up'}
        >
          <ThumbsUp className="h-3 w-3" />
          <span className="sr-only">Good response</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={`h-6 w-6 ${rating === 'down' ? 'text-destructive' : ''}`}
          onClick={() => submit('down')}
          disabled={disabled}
          aria-pressed={rating === 'down'}
        >
          <ThumbsDown className="h-3 w-3" />
          <span className="sr-only">Bad response</span>
        </Button>
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

// ============================================================================
// Composer (input area)
// ============================================================================

interface ChatComposerProps {
  placeholder: string;
}

function ChatComposer({ placeholder }: ChatComposerProps) {
  return (
    <ComposerPrimitive.Root className="border-input bg-background flex items-end gap-2 rounded-2xl border p-2 shadow-xs">
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
    setSelectedAgent,
    setActiveConversation,
    createConversation,
    deleteConversation,
    saveMessages,
    setConnectionStatus,
    setLastError,
    setCurrentTraceId,
  } = useChatStore();

  // Persona is derived from the selectedAgentId — no API call needed.
  const selectedPersona = getPersona(selectedAgentId);
  const { graphContext, clearGraphContext } = useChatGraphContext();

  const [graphSummary, setGraphSummary] = useState<GraphSummaryResponse | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);

  const activeConvRef = useRef(activeConversationId);
  activeConvRef.current = activeConversationId;

  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  // Custom transport that intercepts the streaming response so we can
  // capture the X-Gibson-Trace-Id header into the chat store. The
  // per-message feedback buttons read it from there. AI SDK v6 doesn't
  // expose an `onResponse` callback any more, so wrapping `fetch` on
  // the transport is the canonical extension point.
  const chatTransport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          const traceId = response.headers.get('X-Gibson-Trace-Id');
          if (traceId) {
            setCurrentTraceId(traceId);
          }
          return response;
        },
      }),
    [setCurrentTraceId],
  );

  // Wire to AI SDK useChat — assistant-ui wraps this via useAISDKRuntime
  const aiChat = useAIChat({
    id: activeConversationId || undefined,
    messages: activeConversation?.messages,
    transport: chatTransport,
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

  const handleSelectPersona = useCallback(
    (personaId: string) => {
      setSelectedAgent(personaId);
      const newId = createConversation(personaId, graphContext || undefined);
      setActiveConversation(newId);
      setMessages([]);
    },
    [setSelectedAgent, createConversation, graphContext, setActiveConversation, setMessages],
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

            {/* Persona selector */}
            <PersonaSelector
              selectedId={selectedAgentId}
              onSelect={handleSelectPersona}
            />

            <div className="flex-1" />

            {/* Graph context badge */}
            {graphContext && (
              <GraphContextBadge context={graphContext} onDismiss={clearGraphContext} />
            )}
          </div>

          {/* Messages area */}
          <div className="relative flex-1 overflow-hidden">
            {/* Welcome state when thread is empty */}
            <ThreadPrimitive.If empty>
              <WelcomeState
                agent={selectedPersona}
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
              placeholder={`Message ${selectedPersona.label}...`}
            />
          </div>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
