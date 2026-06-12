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
import { generateConversationTitle, saveConversationAction, loadConversationMessages } from '@/app/actions/chat';

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

  // Track the conversation that ORIGINATED the current in-flight stream.
  //
  // This ref is set when a stream starts (status transitions to 'submitted')
  // and read when the stream ends (status transitions back to 'ready'). It is
  // intentionally separate from activeConvRef so that a mid-stream conversation
  // switch does NOT misattribute the completing stream to the newly selected
  // conversation.
  //
  // Without this, the following race corrupts data:
  //   1. Stream starts on conv-A (activeConvRef = 'conv-A')
  //   2. User switches to conv-B (activeConvRef = 'conv-B')
  //   3. Stream for conv-A finishes → saveMessages('conv-B', messages) ← WRONG
  //
  // With streamingOriginConvRef, step 3 becomes saveMessages('conv-A', messages).
  const streamingOriginConvRef = useRef<string | null>(null);

  // Keep a stable ref to setSystemPromptDebug so the fetch closure doesn't
  // need to be recreated on every render.
  const setDebugRef = useRef(setSystemPromptDebug);
  setDebugRef.current = setSystemPromptDebug;

  // Build a transport that optionally attaches the debug header and reads the
  // debug response header back. The transport is memoised on debugMode so it
  // is only recreated when that flag changes, not on every render.
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
  //
  // streamingOriginConvRef captures the conversation ID at stream START and is
  // used at stream END so that a mid-stream conversation switch cannot misattribute
  // the completing stream to the newly selected conversation (dashboard#555).
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prevStatus = prevStatusRef.current;

    // Capture the streaming origin when the stream begins. We record it on the
    // 'submitted' → * transition (i.e. when the user sends a message) so the
    // origin is fixed for the duration of this stream, regardless of any
    // activeConversationId changes caused by the user switching conversations.
    if (prevStatus === 'ready' && (status === 'submitted' || status === 'streaming')) {
      streamingOriginConvRef.current = activeConvRef.current;
    }

    // When the stream finishes, persist to the ORIGIN conversation, not the
    // currently active one. This prevents misattribution when the user has
    // switched to another conversation while a stream was in flight.
    if (prevStatus === 'streaming' && status === 'ready') {
      // Use streamingOriginConvRef if set; fall back to activeConvRef for
      // callers that started a stream without going through 'submitted' first
      // (e.g. if the AI SDK skips the submitted state in certain transports).
      const convId = streamingOriginConvRef.current ?? activeConvRef.current;
      streamingOriginConvRef.current = null;

      if (convId && messages.length > 0) {
        saveMessages(convId, messages);
        // Persist to the daemon conversation store for cross-session durability.
        const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
        if (conv) {
          // Persist via daemon SaveConversation RPC (dashboard#549 + #550).
          // The action converts UIMessage[] → proto parts via the canonical
          // message normalizer so all part types (tool calls, citations,
          // attachments, reasoning) are preserved losslessly.
          // Fire-and-forget: RPC failures are a silent degradation; the
          // conversation stays in Zustand for the current session.
          void saveConversationAction(
            convId,
            conv.title ?? `Conversation ${convId}`,
            messages,
            conv.agentId,
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
            // Mark immediately, before the async call, to prevent duplicate requests
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
   *
   * If the conversation has no in-memory messages (the normal post-reload state
   * after ConversationListProvider hydrates only conversation metadata), messages
   * are fetched from the daemon via loadConversationMessages. This is the
   * "finalize interrupted streams on reload" path: a conversation whose last
   * assistant message was persisted as a partial (via the stop+persist machinery
   * from dashboard#563) loads cleanly, no spinner, no duplication, regenerate
   * available (dashboard#555).
   *
   * An in-flight stream on another conversation is not affected by this switch
   * because the persist effect uses streamingOriginConvRef (set at stream start)
   * rather than activeConvRef (which this call updates).
   */
  const switchConversation = useCallback(
    (conversationId: string) => {
      const conversation = conversations.find((c) => c.id === conversationId);
      if (!conversation) return;

      setActiveConversation(conversationId);

      if (conversation.messages.length > 0) {
        // Messages already in memory (e.g. conversation was active this session
        // or was loaded before). No daemon fetch needed.
        setMessages(conversation.messages);
        return;
      }

      // Empty message list: this is a post-reload conversation stub. Fetch the
      // full message history from the daemon so the user sees their history and
      // any interrupted trailing assistant message loads cleanly as a completed
      // message. We call setMessages with the empty array first so the UI
      // transitions away from the previous conversation immediately, then
      // update again when the daemon responds.
      setMessages([]);
      void loadConversationMessages(conversationId).then((loaded) => {
        if (loaded && loaded.length > 0) {
          // Write to the Zustand store so the messages survive future
          // in-session switches without hitting the daemon again.
          saveMessages(conversationId, loaded);
          setMessages(loaded);
        }
      });
    },
    [conversations, setActiveConversation, setMessages, saveMessages]
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
