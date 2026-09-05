/**
 * ConversationListProvider
 *
 * Server component that fetches the user's conversation list from the
 * daemon (via UserService.ListConversations) and passes the hydrated list
 * to ConversationListHydrator for merge into the Zustand chat store.
 *
 * When the daemon is unreachable (codes.Unavailable / codes.Internal), the
 * component passes `storeUnavailable={true}` to the hydrator so the chat UI
 * can render a distinct error state, never a silent empty list that looks
 * like data loss.
 *
 * spec: chat-conversation-persistence (dashboard#446)
 * spec: chat-interaction-polish (dashboard#554)
 */

import { listConversations } from '@/src/lib/gibson-client';
import { ConversationListHydrator } from './ConversationListHydrator';
import type { Conversation } from '@/src/stores/chat-store';

interface ConversationListProviderProps {
  children: React.ReactNode;
}

export async function ConversationListProvider({ children }: ConversationListProviderProps) {
  let conversations: Conversation[] = [];
  let storeUnavailable = false;

  try {
    const records = await listConversations(50);
    conversations = records.map((r) => ({
      id: r.id,
      // agent_id is not in the ConversationSummary proto, default to 'general'
      // until GetConversation is fetched on demand.
      agentId: 'general',
      // Messages are empty on list hydration; they are loaded when the user
      // switches to a conversation via switchConversation in useChat.
      messages: [],
      createdAt: new Date(r.createdAt),
      lastMessageAt: new Date(r.updatedAt),
      title: r.title || 'Conversation',
    }));
  } catch {
    // Daemon unreachable or unauthenticated, mark the store as unavailable
    // so the UI can show a distinct error state instead of an empty list.
    storeUnavailable = true;
  }

  return (
    <>
      <ConversationListHydrator
        conversations={conversations}
        storeUnavailable={storeUnavailable}
      />
      {children}
    </>
  );
}
