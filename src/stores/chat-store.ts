/**
 * Chat Store
 *
 * Manages chat state including conversations, agent selection,
 * and graph context integration. Message streaming state is managed
 * by the AI SDK's useChat hook — this store owns conversation
 * persistence and metadata.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { UIMessage } from 'ai';

// ============================================================================
// Types
// ============================================================================

export type AgentStatus = 'online' | 'busy' | 'offline';

export interface ChatAgent {
  id: string;
  name: string;
  description: string;
  status: AgentStatus;
  capabilities: string[];
  icon?: string;
}

export interface GraphContext {
  nodeId?: string;
  nodeType?: string;
  nodeLabel?: string;
  missionId?: string;
  missionName?: string;
}

export interface Conversation {
  id: string;
  agentId: string;
  messages: UIMessage[];
  createdAt: Date;
  lastMessageAt: Date;
  title?: string;
  graphContext?: GraphContext;
}

export interface ChatState {
  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;
  /** IDs of conversations pinned to the top of the sidebar. Persisted locally. */
  pinnedConversationIds: string[];

  // Agent selection
  agents: ChatAgent[];
  selectedAgentId: string;

  // Graph context
  graphContext: GraphContext | null;

  // Connection state
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  lastError: string | null;

  // Last X-Gibson-Trace-Id surfaced by the streaming chat response. The
  // value is overwritten on every assistant turn so the feedback buttons
  // on the latest message always post the right ID. Stored in-memory only
  // (no persistence) — feedback for past sessions isn't a use case.
  currentTraceId: string | null;

  // Debug
  systemPromptDebug: string | null;

  // Actions - Conversations
  createConversation: (agentId: string, graphContext?: GraphContext) => string;
  setActiveConversation: (id: string | null) => void;
  deleteConversation: (id: string) => void;
  clearConversations: () => void;
  saveMessages: (conversationId: string, messages: UIMessage[]) => void;
  /**
   * Finalize an in-progress (partially streamed) assistant message.
   *
   * Called when the user stops a stream mid-flight. The provided `messages`
   * array is the snapshot from the AI SDK at the moment of stop — it already
   * contains the partial assistant text. This action writes that snapshot
   * atomically to the conversation in Zustand, identical to `saveMessages`,
   * but is named distinctly so call-sites and tests can express intent clearly.
   *
   * Idempotent: calling it multiple times with the same messages array is safe
   * and always results in a single, consistent conversation record.
   */
  finalizePartialMessage: (conversationId: string, messages: UIMessage[]) => void;
  /**
   * Truncate a conversation's message list to include only messages up to and
   * including the message at `upToIndex` (0-based). All messages after that
   * index are dropped atomically.
   *
   * This is the store mirror of what `useAISDKRuntime`'s `onEdit`/`onReload`
   * does to the AI SDK's own messages array before re-streaming: truncate first,
   * then submit. Calling `truncateMessages` on the store ensures Zustand stays
   * coherent with the AI SDK state so that if the page reloads between truncate
   * and re-stream completion no orphaned downstream messages survive.
   *
   * The action is a no-op when `upToIndex` is out of range or the conversation
   * does not exist.
   */
  truncateMessages: (conversationId: string, upToIndex: number) => void;
  /**
   * Edit the text of a specific user message in a conversation.
   *
   * Replaces the first text part of the message at `messageIndex` with
   * `newText`. Does not truncate downstream messages — callers that need
   * truncation should call `truncateMessages` after editing.
   *
   * The action is a no-op when the message is not found or has no text part.
   */
  editMessageText: (conversationId: string, messageId: string, newText: string) => void;
  hydrateConversations: (conversations: Conversation[]) => void;
  updateConversationTitle: (id: string, title: string) => void;
  togglePinConversation: (id: string) => void;
  isConversationPinned: (id: string) => boolean;

  // Actions - Agents
  setAgents: (agents: ChatAgent[]) => void;
  setSelectedAgent: (agentId: string) => void;
  updateAgentStatus: (agentId: string, status: AgentStatus) => void;

  // Actions - Graph Context
  setGraphContext: (context: GraphContext | null) => void;
  clearGraphContext: () => void;

  // Actions - Connection
  setConnectionStatus: (status: ChatState['connectionStatus']) => void;
  setLastError: (error: string | null) => void;

  // Actions - Trace
  setCurrentTraceId: (id: string | null) => void;

  // Actions - Debug
  setSystemPromptDebug: (value: string | null) => void;

  // Selectors
  getActiveConversation: () => Conversation | undefined;
  getConversationMessages: (conversationId: string) => UIMessage[];
  getAgentById: (agentId: string) => ChatAgent | undefined;
}

// ============================================================================
// Default agents
// ============================================================================

const DEFAULT_AGENTS: ChatAgent[] = [
  {
    id: 'general',
    name: 'General Assistant',
    description: 'General purpose assistant for questions and guidance',
    status: 'online',
    capabilities: ['general', 'help', 'documentation'],
    icon: 'bot',
  },
  {
    id: 'recon',
    name: 'Reconnaissance Agent',
    description: 'Specializes in target enumeration and discovery',
    status: 'online',
    capabilities: ['recon', 'enumeration', 'osint'],
    icon: 'search',
  },
  {
    id: 'exploit',
    name: 'Exploit Agent',
    description: 'Vulnerability exploitation and payload generation',
    status: 'online',
    capabilities: ['exploit', 'payloads', 'vulnerabilities'],
    icon: 'zap',
  },
  {
    id: 'analysis',
    name: 'Analysis Agent',
    description: 'Deep analysis of findings and attack paths',
    status: 'online',
    capabilities: ['analysis', 'reporting', 'correlation'],
    icon: 'activity',
  },
];

// ============================================================================
// Store
// ============================================================================

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      // Initial state
      conversations: [],
      activeConversationId: null,
      pinnedConversationIds: [],
      agents: DEFAULT_AGENTS,
      selectedAgentId: 'general',
      graphContext: null,
      connectionStatus: 'disconnected',
      lastError: null,
      currentTraceId: null,
      systemPromptDebug: null,

      // Conversation actions
      createConversation: (agentId, graphContext) => {
        const id = `conv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const now = new Date();
        const agent = get().agents.find((a) => a.id === agentId);

        const newConversation: Conversation = {
          id,
          agentId,
          messages: [],
          createdAt: now,
          lastMessageAt: now,
          title: graphContext?.nodeLabel
            ? `Chat about ${graphContext.nodeLabel}`
            : `Chat with ${agent?.name || 'Agent'}`,
          graphContext,
        };

        set((state) => ({
          conversations: [newConversation, ...state.conversations],
          activeConversationId: id,
          graphContext: graphContext || state.graphContext,
        }));

        return id;
      },

      setActiveConversation: (id) => {
        set({ activeConversationId: id });
      },

      deleteConversation: (id) => {
        set((state) => ({
          conversations: state.conversations.filter((c) => c.id !== id),
          activeConversationId:
            state.activeConversationId === id ? null : state.activeConversationId,
        }));
      },

      clearConversations: () => {
        set({ conversations: [], activeConversationId: null });
      },

      saveMessages: (conversationId, messages) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages,
                  lastMessageAt: new Date(),
                }
              : conv
          ),
        }));
      },

      finalizePartialMessage: (conversationId, messages) => {
        // Atomic replacement of the message list. The messages array from the
        // AI SDK already contains the partial assistant text at the moment of
        // stop — we do not need to mutate any individual message; the SDK has
        // already materialized the streamed content into the parts array.
        // Using the same replacement semantics as saveMessages ensures there
        // is never a dangling partial or a duplicate entry.
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages,
                  lastMessageAt: new Date(),
                }
              : conv
          ),
        }));
      },

      truncateMessages: (conversationId, upToIndex) => {
        set((state) => ({
          conversations: state.conversations.map((conv) => {
            if (conv.id !== conversationId) return conv;
            if (upToIndex < 0 || upToIndex >= conv.messages.length) return conv;
            return {
              ...conv,
              messages: conv.messages.slice(0, upToIndex + 1),
              lastMessageAt: new Date(),
            };
          }),
        }));
      },

      editMessageText: (conversationId, messageId, newText) => {
        set((state) => ({
          conversations: state.conversations.map((conv) => {
            if (conv.id !== conversationId) return conv;
            const msgIdx = conv.messages.findIndex((m) => m.id === messageId);
            if (msgIdx === -1) return conv;
            const updated = conv.messages.map((msg, idx) => {
              if (idx !== msgIdx) return msg;
              // Replace the first text part; leave all other parts intact.
              const parts = msg.parts.map((part, pIdx) => {
                if (part.type === 'text' && pIdx === msg.parts.findIndex((p) => p.type === 'text')) {
                  return { ...part, text: newText };
                }
                return part;
              });
              return { ...msg, parts };
            });
            return { ...conv, messages: updated };
          }),
        }));
      },

      hydrateConversations: (incoming) => {
        set((state) => {
          const existingIds = new Set(state.conversations.map((c) => c.id));
          const newConvs = incoming.filter((c) => !existingIds.has(c.id));
          return { conversations: [...state.conversations, ...newConvs] };
        });
      },

      updateConversationTitle: (id, title) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === id ? { ...conv, title } : conv
          ),
        }));
      },

      togglePinConversation: (id) => {
        set((state) => {
          const pinned = state.pinnedConversationIds.includes(id);
          return {
            pinnedConversationIds: pinned
              ? state.pinnedConversationIds.filter((pid) => pid !== id)
              : [...state.pinnedConversationIds, id],
          };
        });
      },

      isConversationPinned: (id) => {
        return get().pinnedConversationIds.includes(id);
      },

      // Agent actions
      setAgents: (agents) => {
        set({ agents });
      },

      setSelectedAgent: (agentId) => {
        set({ selectedAgentId: agentId });
      },

      updateAgentStatus: (agentId, status) => {
        set((state) => ({
          agents: state.agents.map((agent) =>
            agent.id === agentId ? { ...agent, status } : agent
          ),
        }));
      },

      // Graph context actions
      setGraphContext: (context) => {
        set({ graphContext: context });
      },

      clearGraphContext: () => {
        set({ graphContext: null });
      },

      // Connection actions
      setConnectionStatus: (status) => {
        set({ connectionStatus: status });
      },

      setLastError: (error) => {
        set({ lastError: error });
      },

      setCurrentTraceId: (id) => {
        set({ currentTraceId: id });
      },

      // Debug actions
      setSystemPromptDebug: (value) => {
        set({ systemPromptDebug: value });
      },

      // Selectors
      getActiveConversation: () => {
        const state = get();
        return state.conversations.find(
          (c) => c.id === state.activeConversationId
        );
      },

      getConversationMessages: (conversationId) => {
        const state = get();
        return (
          state.conversations.find((c) => c.id === conversationId)?.messages || []
        );
      },

      getAgentById: (agentId) => {
        return get().agents.find((a) => a.id === agentId);
      },
    }),
    {
      name: 'gibson-chat-store',
      // conversations/activeConversationId are daemon-backed (Redis via UserService).
      // Pin preferences are local-only: no cross-device sync needed for a UI sort hint.
      partialize: (state) => ({
        selectedAgentId: state.selectedAgentId,
        agents: state.agents,
        pinnedConversationIds: state.pinnedConversationIds,
      }),
    }
  )
);

// ============================================================================
// Selector hooks
// ============================================================================

export const useActiveConversation = () => {
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const conversations = useChatStore((state) => state.conversations);
  return conversations.find((c) => c.id === activeConversationId);
};

export const useChatMessages = () => {
  const activeConversationId = useChatStore((state) => state.activeConversationId);
  const conversations = useChatStore((state) => state.conversations);
  const conversation = conversations.find((c) => c.id === activeConversationId);
  return conversation?.messages || [];
};

export const useSelectedAgent = () => {
  const selectedAgentId = useChatStore((state) => state.selectedAgentId);
  const agents = useChatStore((state) => state.agents);
  return agents.find((a) => a.id === selectedAgentId);
};

export const useChatGraphContext = () => {
  const graphContext = useChatStore((state) => state.graphContext);
  const setGraphContext = useChatStore((state) => state.setGraphContext);
  const clearGraphContext = useChatStore((state) => state.clearGraphContext);
  return { graphContext, setGraphContext, clearGraphContext };
};

export const useChatConnection = () => {
  const connectionStatus = useChatStore((state) => state.connectionStatus);
  const lastError = useChatStore((state) => state.lastError);
  const setConnectionStatus = useChatStore((state) => state.setConnectionStatus);
  const setLastError = useChatStore((state) => state.setLastError);
  return { connectionStatus, lastError, setConnectionStatus, setLastError };
};
