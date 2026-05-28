/**
 * Chat Hook
 *
 * Thin wrapper around the AI SDK's useChat hook that integrates
 * with the Zustand chat store for conversation management and graph context.
 */

'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useChat as useAIChat } from '@ai-sdk/react';
import type { UIMessage } from 'ai';
import { useChatStore } from '@/src/stores/chat-store';

// Re-exported convenience types
export type UseChatOptions = Parameters<typeof useAIChat>[0];
export type SendMessageOptions = Parameters<ReturnType<typeof useAIChat>['sendMessage']>[0];

export function useChat() {
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
  } = useChatStore();

  // Track the current conversation to avoid stale closures
  const activeConvRef = useRef(activeConversationId);
  activeConvRef.current = activeConversationId;

  // Load initial messages from the active conversation
  const activeConversation = conversations.find(
    (c) => c.id === activeConversationId
  );

  const aiChat = useAIChat({
    id: activeConversationId || undefined,
    messages: activeConversation?.messages,
    // body is passed via transport in AI SDK v6 — agent/context forwarded server-side
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

  // Persist messages to Zustand AND daemon-backed Redis when stream completes.
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current === 'streaming' && status === 'ready') {
      const convId = activeConvRef.current;
      if (convId && messages.length > 0) {
        saveMessages(convId, messages);
        // Fire-and-forget persist to Redis for cross-session durability.
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
          fetch('/api/chat/conversation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }).catch((err) => {
            if (process.env.NODE_ENV !== 'production') {
              console.warn('[useChat] Failed to persist conversation to Redis:', err);
            }
          });
        }
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
