'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Send,
  Square,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { ChatContainer } from '@/components/ui/custom/prompt/chat-container';
import {
  Input as PromptInput,
  PromptInputTextarea,
  PromptInputActions,
  PromptInputAction,
} from '@/components/ui/custom/prompt/input';
import {
  Message,
  MessageAvatar,
  MessageContent,
} from '@/components/ui/custom/prompt/message';
import { PromptScrollButton } from '@/components/ui/custom/prompt/scroll-button';
import { useChat } from '@/src/hooks/useChat';
import {
  useChatStore,
  useSelectedAgent,
  useChatGraphContext,
} from '@/src/stores/chat-store';
import { ConversationList } from './ConversationList';
import { AgentSelector } from './AgentSelector';
import { WelcomeState } from './WelcomeState';
import { GraphContextBadge } from './GraphContextBadge';
import type { GraphSummaryResponse } from '@/src/lib/graph/summary';

// ============================================================================
// ChatContent
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
  } = useChatStore();

  const selectedAgent = useSelectedAgent();
  const { graphContext, clearGraphContext } = useChatGraphContext();

  const { messages, status, error, send, stop, startNewConversation, switchConversation, isLoading } = useChat();

  const [inputValue, setInputValue] = useState('');
  const [graphSummary, setGraphSummary] = useState<GraphSummaryResponse | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [providerError, setProviderError] = useState<string | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const scrollToRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  // Auto-focus input on mount and conversation switch
  useEffect(() => {
    inputRef.current?.focus();
  }, [activeConversationId]);

  // Track provider errors from chat hook
  useEffect(() => {
    if (error?.message?.includes('503') || error?.message?.toLowerCase().includes('provider')) {
      setProviderError('No LLM provider configured. Go to Settings > Providers to set up your API key.');
    } else if (error) {
      setProviderError(null);
    }
  }, [error]);

  // Send message handler
  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    setInputValue('');
    setProviderError(null);
    send(text);
  }, [inputValue, isLoading, send]);

  // Send a suggested prompt
  const handleSuggestion = useCallback(
    (text: string) => {
      setInputValue('');
      setProviderError(null);
      send(text);
    },
    [send],
  );

  // New conversation
  const handleNewConversation = useCallback(() => {
    startNewConversation();
    setInputValue('');
    inputRef.current?.focus();
  }, [startNewConversation]);

  // Switch conversation
  const handleSwitchConversation = useCallback(
    (id: string) => {
      switchConversation(id);
      setInputValue('');
      inputRef.current?.focus();
    },
    [switchConversation],
  );

  // Select agent
  const handleSelectAgent = useCallback(
    (agentId: string) => {
      setSelectedAgent(agentId);
      startNewConversation();
      inputRef.current?.focus();
    },
    [setSelectedAgent, startNewConversation],
  );

  // Retry last message
  const handleRetry = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg && 'content' in lastUserMsg) {
      const content = typeof lastUserMsg.content === 'string' ? lastUserMsg.content : '';
      if (content) {
        send(content);
      }
    }
  }, [messages, send]);

  const hasMessages = messages.length > 0;
  const isStreaming = status === 'streaming';
  const activeConversation = conversations.find((c) => c.id === activeConversationId);

  const conversationListContent = (
    <ConversationList
      conversations={conversations}
      activeId={activeConversationId}
      agents={agents}
      onSelect={handleSwitchConversation}
      onNew={handleNewConversation}
      onDelete={(id) => deleteConversation(id)}
    />
  );

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="flex h-[var(--content-full-height)]">
      {/* Desktop conversation sidebar */}
      {sidebarOpen && (
        <div className="hidden w-72 shrink-0 border-r lg:block">
          {conversationListContent}
        </div>
      )}

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <div className="flex items-center gap-2 border-b px-4 py-2">
          {/* Mobile: sheet trigger for conversation list */}
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
                {conversationListContent}
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
        </div>

        {/* Messages area */}
        <div className="relative flex-1 overflow-hidden">
          {!hasMessages && !activeConversation ? (
            <WelcomeState
              agent={selectedAgent}
              graphSummary={graphSummary}
              onSendPrompt={handleSuggestion}
            />
          ) : (
            /* Messages */
            <ChatContainer
              ref={chatContainerRef}
              scrollToRef={scrollToRef}
              className="h-full px-4 py-4"
            >
              {messages.map((msg) => {
                const isUser = msg.role === 'user';
                const msgUnknown = msg as unknown as Record<string, unknown>;
                const content =
                  typeof msgUnknown.content === 'string'
                    ? msgUnknown.content
                    : Array.isArray(msg.parts)
                      ? msg.parts
                          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                          .map((p) => p.text)
                          .join('')
                      : '';

                return (
                  <Message
                    key={msg.id}
                    className={`mb-4 ${isUser ? 'flex-row-reverse' : ''}`}
                  >
                    <MessageAvatar
                      src={isUser ? '' : '/gibson-avatar.svg'}
                      alt={isUser ? 'You' : 'Zero Day AI'}
                      fallback={isUser ? 'U' : 'Z'}
                    />
                    <MessageContent
                      markdown={!isUser}
                      className={
                        isUser
                          ? 'bg-primary text-primary-foreground max-w-[80%]'
                          : 'bg-secondary max-w-[80%]'
                      }
                    >
                      {content}
                    </MessageContent>
                  </Message>
                );
              })}

              {/* Streaming indicator */}
              {isStreaming && messages[messages.length - 1]?.role !== 'assistant' && (
                <Message className="mb-4">
                  <MessageAvatar src="/gibson-avatar.svg" alt="Zero Day AI" fallback="Z" />
                  <div className="bg-secondary flex items-center gap-2 rounded-lg px-4 py-3">
                    <div className="flex gap-1">
                      <span className="bg-muted-foreground h-2 w-2 animate-bounce rounded-full [animation-delay:0ms]" />
                      <span className="bg-muted-foreground h-2 w-2 animate-bounce rounded-full [animation-delay:150ms]" />
                      <span className="bg-muted-foreground h-2 w-2 animate-bounce rounded-full [animation-delay:300ms]" />
                    </div>
                  </div>
                </Message>
              )}

              {/* Error state with retry */}
              {error && !providerError && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive dark:border-destructive/40 dark:bg-destructive/10 dark:text-destructive">
                  <span className="flex-1">Response failed. {error.message}</span>
                  <Button variant="ghost" size="sm" onClick={handleRetry}>
                    <RefreshCw className="mr-1 h-3 w-3" />
                    Retry
                  </Button>
                </div>
              )}
            </ChatContainer>
          )}

          {/* Scroll to bottom button */}
          {hasMessages && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2">
              <PromptScrollButton
                scrollRef={scrollToRef}
                containerRef={chatContainerRef}
              />
            </div>
          )}
        </div>

        {/* Provider error banner */}
        {providerError && (
          <div className="border-t border-alt/40 bg-alt/10 px-4 py-2 text-sm text-alt dark:border-alt/40 dark:bg-alt/10 dark:text-alt">
            {providerError}
          </div>
        )}

        {/* Input area */}
        <div className="border-t p-4">
          <PromptInput
            isLoading={isLoading}
            value={inputValue}
            onValueChange={setInputValue}
            onSubmit={handleSend}
          >
            <PromptInputTextarea
              ref={inputRef}
              placeholder={
                isLoading
                  ? 'Waiting for response...'
                  : `Message ${selectedAgent?.name || 'Zero Day AI'}...`
              }
            />
            <PromptInputActions className="justify-end">
              {isStreaming ? (
                <PromptInputAction tooltip="Stop generating">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={stop}>
                    <Square className="h-4 w-4" />
                  </Button>
                </PromptInputAction>
              ) : (
                <PromptInputAction tooltip="Send message">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isLoading}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </PromptInputAction>
              )}
            </PromptInputActions>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}

