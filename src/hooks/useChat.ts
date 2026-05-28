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

export interface UseChatConfig {
  /** When true, the X-Gibson-Debug header is sent and the system prompt debug panel is populated. */
  debugMode?: boolean;
}

// Re-exported convenience types
export type UseChatOptions = Parameters<typeof useAIChat>[0];
export type SendMessageOptions = Parameters<ReturnType<typeof useAIChat>['sendMessage']>[0];

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
  } = useChatStore();

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

  // Persist messages to Zustand when stream completes
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === 'streaming' && status === 'ready') {
      if (activeConvRef.current && messages.length > 0) {
        saveMessages(activeConvRef.current, messages);
      }
    }
    prevStatusRef.current = status;
  }, [status, messages, saveMessages]);

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
