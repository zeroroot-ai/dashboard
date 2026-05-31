/**
 * Chat Hook
 *
 * Thin wrapper around the AI SDK's useChat hook that integrates
 * with the Zustand chat store for conversation management and graph context.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useChat as useAIChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import type { UIMessage } from 'ai';
import { useChatStore } from '@/src/stores/chat-store';
import { generateConversationTitle, saveConversationAction } from '@/app/actions/chat';

export interface UseChatConfig {
  /** When true, the X-Gibson-Debug header is sent and the system prompt debug panel is populated. */
  debugMode?: boolean;
}

// Re-exported convenience types
export type UseChatOptions = Parameters<typeof useAIChat>[0];
export type SendMessageOptions = Parameters<ReturnType<typeof useAIChat>['sendMessage']>[0];

/** Default placeholder titles that should be replaced by the auto-title. */
const DEFAULT_TITLE_PREFIXES = ['New conversation', 'Chat with ', 'Chat about '];

function isDefaultTitle(title: string | undefined): boolean {
  if (!title) return true;
  return DEFAULT_TITLE_PREFIXES.some((prefix) => title.startsWith(prefix));
}

export function useChat(config?: UseChatConfig) {
  const {
    activeConversationId,
    selectedAgentId,
    graphContext,
    conversations,
    createConversation,
    setActiveConversation,
    setConnectionStatus,
    setLastError,
    saveMessages,
    setSystemPromptDebug,
    updateConversationTitle,
  } = useChatStore();

  // Track which conversationIds have already been auto-titled this session.
  // Using a ref (not state) so the check never triggers a re-render.
  const titledConversations = useRef<Set<string>>(new Set());

  const debugMode = config?.debugMode ?? false;

  // Track the current conversation to avoid stale closures
  const activeConvRef = useRef(activeConversationId);
  activeConvRef.current = activeConversationId;

  // Keep a stable ref to setSystemPromptDebug so the fetch closure doesn't
  // need to be recreated on every render.
  const setDebugRef = useRef(setSystemPromptDebug);
  setDebugRef.current = setSystemPromptDebug;

  // Build a transport that optionally attaches the debug header and reads the
  // debug response header back. The transport is memoised on debugMode so it
  // is only recreated when that flag changes — not on every render.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        headers: debugMode ? { 'X-Gibson-Debug': '1' } : undefined,
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          const debugPayload = response.headers.get('X-Gibson-System-Prompt-Debug');
          if (debugPayload) {
            setDebugRef.current(decodeURIComponent(debugPayload));
          }
          return response;
        },
      }),
    [debugMode],
  );

  // Load initial messages from the active conversation
  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  );

  const aiChat = useAIChat({
    id: activeConversationId || undefined,
    messages: activeConversation?.messages,
    transport,
    onError: (error) => {
      setConnectionStatus('error');
      setLastError(error.message);
    },
    onFinish: () => {
      setConnectionStatus('connected');
      setLastError(null);
    },
  });

  const { messages, status, error, sendMessage, stop, setMessages } = aiChat;

  // Persist messages to Zustand and daemon (via SaveConversation RPC) when stream completes.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === 'streaming' && status === 'ready') {
      const convId = activeConvRef.current;
      if (convId && messages.length > 0) {
        saveMessages(convId, messages);
        // Persist to the daemon conversation store for cross-session durability.
        const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
        if (conv) {
          const payload = {
            conversationId: convId,
            title: conv.title ?? `Conversation ${convId}`,
            agentId: conv.agentId,
            messages: messages.map((m) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant' | 'system' | 'tool',
              content: m.parts
                .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                .map((p) => p.text)
                .join(''),
            })),
          };
          // Persist via daemon SaveConversation RPC (dashboard#549).
          // Fire-and-forget: RPC failures are a silent degradation; the
          // conversation stays in Zustand for the current session.
          void saveConversationAction(
            payload.conversationId,
            payload.title,
            payload.messages,
            payload.agentId,
          );

          // Auto-title: fire once after the FIRST exchange (1 user + 1 assistant
          // message) if the conversation still has its default placeholder title.
          const userMessages = messages.filter((m) => m.role === 'user');
          const assistantMessages = messages.filter((m) => m.role === 'assistant');
          const isFirstExchange = userMessages.length === 1 && assistantMessages.length === 1;
          const hasDefaultTitle = isDefaultTitle(conv.title);

          if (
            isFirstExchange &&
            hasDefaultTitle &&
            !titledConversations.current.has(convId)
          ) {
            // Mark immediately — before the async call — to prevent duplicate requests
            // if the effect fires more than once in the same session.
            titledConversations.current.add(convId);

            const firstUserText = userMessages[0].parts
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('');
            const firstAssistantText = assistantMessages[0].parts
              .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
              .map((p) => p.text)
              .join('');

            void generateConversationTitle(convId, firstUserText, firstAssistantText).then(
              (title) => {
                if (title) {
                  updateConversationTitle(convId, title);
                }
              },
            );
          }
        }
      }
    }
    prevStatusRef.current = status;
  }, [status, messages, saveMessages, updateConversationTitle]);

  // Update connection status based on chat status
  useEffect(() => {
    if (status === 'streaming' || status === 'submitted') {
      setConnectionStatus('connected');
    }
  }, [status, setConnectionStatus]);

  /**
   * Send a user message. Creates a conversation if none is active.
   */
  const send = useCallback(
    async (text: string) => {
      if (!text.trim()) return;

      // Ensure a conversation exists
      if (!activeConvRef.current) {
        const newId = createConversation(
          selectedAgentId,
          graphContext || undefined
        );
        setActiveConversation(newId);
      }

      setLastError(null);
      await sendMessage({ text });
    },
    [createConversation, selectedAgentId, graphContext, setActiveConversation, setLastError, sendMessage]
  );

  /**
   * Switch to a different conversation by loading its messages.
   */
  const switchConversation = useCallback(
    (conversationId: string) => {
      const conversation = conversations.find((c) => c.id === conversationId);
      if (conversation) {
        setActiveConversation(conversationId);
        setMessages(conversation.messages);
      }
    },
    [conversations, setActiveConversation, setMessages]
  );

  /**
   * Start a new conversation.
   */
  const startNewConversation = useCallback(() => {
    const newId = createConversation(
      selectedAgentId,
      graphContext || undefined
    );
    setActiveConversation(newId);
    setMessages([]);
    return newId;
  }, [createConversation, selectedAgentId, graphContext, setActiveConversation, setMessages]);

  return {
    messages,
    status,
    error,
    send,
    stop,
    setMessages,
    switchConversation,
    startNewConversation,
    isLoading: status === 'submitted' || status === 'streaming',
  };
}
