'use client';

/**
 * ConversationListHydrator
 *
 * Client component that receives daemon-fetched conversations from
 * ConversationListProvider and merges them into the Zustand chat store on
 * mount. Renders nothing, it is purely a hydration side-effect.
 *
 * When `storeUnavailable` is true, it sets `conversationStoreError` in the
 * store so the chat UI can render a distinct error state (never a silent
 * empty list that looks like data loss).
 *
 * spec: chat-conversation-persistence (dashboard#446)
 * spec: chat-interaction-polish (dashboard#554)
 */

import { useEffect } from 'react';
import { useChatStore } from '@/src/stores/chat-store';
import type { Conversation } from '@/src/stores/chat-store';

interface ConversationListHydratorProps {
  conversations: Conversation[];
  /** True when the daemon ListConversations RPC failed (Unavailable/Internal). */
  storeUnavailable?: boolean;
}

export function ConversationListHydrator({
  conversations,
  storeUnavailable = false,
}: ConversationListHydratorProps) {
  const hydrateConversations = useChatStore((state) => state.hydrateConversations);
  const setConversationStoreError = useChatStore((state) => state.setConversationStoreError);

  useEffect(() => {
    if (storeUnavailable) {
      setConversationStoreError(true);
    } else if (conversations.length > 0) {
      hydrateConversations(conversations);
    }
    // Run once on mount, the props are stable (passed from a server component
    // that only renders once per page load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
