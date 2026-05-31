/**
 * Chat Store — pin + rename unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat-store';
import type { Conversation } from './chat-store';

const now = new Date('2026-01-01T00:00:00Z');

function makeConv(id: string, overrides: Partial<Conversation> = {}): Conversation {
  return {
    id,
    agentId: 'general',
    messages: [],
    createdAt: now,
    lastMessageAt: now,
    title: `Conv ${id}`,
    ...overrides,
  };
}

describe('Chat Store — togglePinConversation', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [makeConv('a'), makeConv('b'), makeConv('c')],
      pinnedConversationIds: [],
    });
  });

  it('pins an unpinned conversation', () => {
    useChatStore.getState().togglePinConversation('a');
    expect(useChatStore.getState().pinnedConversationIds).toContain('a');
  });

  it('unpins a pinned conversation', () => {
    useChatStore.setState({ pinnedConversationIds: ['a'] });
    useChatStore.getState().togglePinConversation('a');
    expect(useChatStore.getState().pinnedConversationIds).not.toContain('a');
  });

  it('preserves other pinned ids when toggling one', () => {
    useChatStore.setState({ pinnedConversationIds: ['b'] });
    useChatStore.getState().togglePinConversation('a');
    const { pinnedConversationIds } = useChatStore.getState();
    expect(pinnedConversationIds).toContain('a');
    expect(pinnedConversationIds).toContain('b');
  });
});

describe('Chat Store — isConversationPinned', () => {
  beforeEach(() => {
    useChatStore.setState({ pinnedConversationIds: ['x'] });
  });

  it('returns true for a pinned conversation', () => {
    expect(useChatStore.getState().isConversationPinned('x')).toBe(true);
  });

  it('returns false for an unpinned conversation', () => {
    expect(useChatStore.getState().isConversationPinned('y')).toBe(false);
  });
});

describe('Chat Store — updateConversationTitle (rename)', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [makeConv('a', { title: 'Old Title' }), makeConv('b')],
    });
  });

  it('updates the title of the targeted conversation', () => {
    useChatStore.getState().updateConversationTitle('a', 'New Title');
    const conv = useChatStore.getState().conversations.find((c) => c.id === 'a');
    expect(conv?.title).toBe('New Title');
  });

  it('leaves other conversations untouched', () => {
    useChatStore.getState().updateConversationTitle('a', 'New Title');
    const convB = useChatStore.getState().conversations.find((c) => c.id === 'b');
    expect(convB?.title).toBe('Conv b');
  });

  it('can be reverted by calling updateConversationTitle with the old title', () => {
    useChatStore.getState().updateConversationTitle('a', 'New Title');
    // Simulate RPC failure revert
    useChatStore.getState().updateConversationTitle('a', 'Old Title');
    const conv = useChatStore.getState().conversations.find((c) => c.id === 'a');
    expect(conv?.title).toBe('Old Title');
  });
});

describe('Chat Store — deleteConversation', () => {
  beforeEach(() => {
    useChatStore.setState({
      conversations: [makeConv('a'), makeConv('b'), makeConv('c')],
      activeConversationId: 'a',
    });
  });

  it('removes the targeted conversation from the list', () => {
    useChatStore.getState().deleteConversation('a');
    const ids = useChatStore.getState().conversations.map((c) => c.id);
    expect(ids).not.toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
  });

  it('clears activeConversationId when the active conversation is deleted', () => {
    useChatStore.getState().deleteConversation('a');
    expect(useChatStore.getState().activeConversationId).toBeNull();
  });

  it('preserves activeConversationId when a different conversation is deleted', () => {
    useChatStore.getState().deleteConversation('b');
    expect(useChatStore.getState().activeConversationId).toBe('a');
  });
});
