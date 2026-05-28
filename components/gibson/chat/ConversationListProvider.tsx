/**
 * ConversationListProvider
 *
 * Server component that fetches the user's conversation list from the
 * daemon (via UserService.ListConversations) and passes the hydrated list
 * to ConversationListHydrator for merge into the Zustand chat store.
 *
 * Rendering failures are caught and silenced — the chat page must always
 * render even when the daemon is unreachable (the user still gets an empty
 * conversation list, not an error page).
 *
 * spec: chat-conversation-persistence (dashboard#446)
 */

import { listConversations } from '@/src/lib/gibson-client';
import { ConversationListHydrator } from './ConversationListHydrator';
import type { Conversation } from '@/src/stores/chat-store';

interface ConversationListProviderProps {
  children: React.ReactNode;
}

export async function ConversationListProvider({ children }: ConversationListProviderProps) {
  let conversations: Conversation[] = [];

  try {
    const records = await listConversations(50);
    conversations = records.map((r) => ({
      id: r.id,
      // agent_id is not in the ConversationSummary proto — default to 'general'
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
    // Daemon unreachable or unauthenticated — degrade gracefully.
    // The chat page will still render; the store stays empty.
  }

  return (
    <>
      <ConversationListHydrator conversations={conversations} />
      {children}
    </>
  );
}
