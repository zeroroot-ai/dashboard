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

  // Actions - Conversations
  createConversation: (agentId: string, graphContext?: GraphContext) => string;
  setActiveConversation: (id: string | null) => void;
  deleteConversation: (id: string) => void;
  clearConversations: () => void;
  saveMessages: (conversationId: string, messages: UIMessage[]) => void;
  hydrateConversations: (conversations: Conversation[]) => void;

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
      agents: DEFAULT_AGENTS,
      selectedAgentId: 'general',
      graphContext: null,
      connectionStatus: 'disconnected',
      lastError: null,
      currentTraceId: null,

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

      hydrateConversations: (incoming) => {
        set((state) => {
          const existingIds = new Set(state.conversations.map((c) => c.id));
          const newConvs = incoming.filter((c) => !existingIds.has(c.id));
          return { conversations: [...state.conversations, ...newConvs] };
        });
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
      // Only persist conversations and selected agent
      // Conversation durability is now daemon-backed (Redis via UserService).
      // conversations and activeConversationId are NOT persisted here.
      partialize: (state) => ({
        selectedAgentId: state.selectedAgentId,
        agents: state.agents,
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
