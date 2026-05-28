'use client';

/**
 * ConversationListHydrator
 *
 * Client component that receives daemon-fetched conversations from
 * ConversationListProvider and merges them into the Zustand chat store on
 * mount. Renders nothing — it is purely a hydration side-effect.
 *
 * spec: chat-conversation-persistence (dashboard#446)
 */

import { useEffect } from 'react';
import { useChatStore } from '@/src/stores/chat-store';
import type { Conversation } from '@/src/stores/chat-store';

interface ConversationListHydratorProps {
  conversations: Conversation[];
}

export function ConversationListHydrator({ conversations }: ConversationListHydratorProps) {
  const hydrateConversations = useChatStore((state) => state.hydrateConversations);

  useEffect(() => {
    if (conversations.length > 0) {
      hydrateConversations(conversations);
    }
    // Run once on mount — the prop is stable (passed from a server component
    // that only renders once per page load).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
