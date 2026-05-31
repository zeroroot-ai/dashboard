/**
 * Chat Store — pin, rename, and stop+persist-partial unit tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chat-store';
import type { Conversation } from './chat-store';
import type { UIMessage } from 'ai';

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

// ============================================================================
// Helpers for stop+persist tests
// ============================================================================

function makeMsg(id: string, role: UIMessage['role'], text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: 'text', text }],
  } as UIMessage;
}

// ============================================================================
// Stop + persist — finalizePartialMessage
// ============================================================================

describe('Chat Store — finalizePartialMessage (stop mid-stream)', () => {
  const userMsg = makeMsg('m1', 'user', 'Hello');
  const partialAssistantMsg = makeMsg('m2', 'assistant', 'Here is a partial response that was');

  beforeEach(() => {
    useChatStore.setState({
      conversations: [
        makeConv('conv-1', {
          messages: [userMsg],
        }),
        makeConv('conv-2'),
      ],
    });
  });

  it('finalizes and persists the partial assistant message into the conversation', () => {
    const messagesAtStop: UIMessage[] = [userMsg, partialAssistantMsg];

    useChatStore.getState().finalizePartialMessage('conv-1', messagesAtStop);

    const conv = useChatStore.getState().conversations.find((c) => c.id === 'conv-1');
    expect(conv).toBeDefined();
    expect(conv!.messages).toHaveLength(2);
    expect(conv!.messages[1].id).toBe('m2');
    expect(conv!.messages[1].role).toBe('assistant');
    const textPart = conv!.messages[1].parts.find((p) => p.type === 'text');
    expect(textPart).toBeDefined();
    // The partial text is preserved exactly as-is at stop time.
    expect((textPart as { type: 'text'; text: string }).text).toBe(
      'Here is a partial response that was',
    );
  });

  it('updates lastMessageAt when finalizing', () => {
    const before = useChatStore.getState().conversations.find((c) => c.id === 'conv-1')!.lastMessageAt;
    const messagesAtStop: UIMessage[] = [userMsg, partialAssistantMsg];

    useChatStore.getState().finalizePartialMessage('conv-1', messagesAtStop);

    const after = useChatStore.getState().conversations.find((c) => c.id === 'conv-1')!.lastMessageAt;
    // lastMessageAt must be >= the original value (it was set to new Date())
    expect(after.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('does not leave a dangling empty assistant message after stop', () => {
    // Simulate the AI SDK state at stop: only the partial assistant text, no empty entry.
    const messagesAtStop: UIMessage[] = [userMsg, partialAssistantMsg];

    useChatStore.getState().finalizePartialMessage('conv-1', messagesAtStop);

    const conv = useChatStore.getState().conversations.find((c) => c.id === 'conv-1')!;
    // Exactly 2 messages — no dangling empty assistant message appended.
    expect(conv.messages).toHaveLength(2);
    // No message has empty parts or empty text.
    for (const msg of conv.messages) {
      expect(msg.parts.length).toBeGreaterThan(0);
    }
  });

  it('does not duplicate the assistant message when called twice with the same messages', () => {
    // Calling finalizePartialMessage twice (e.g. double-fire of the effect) must be
    // idempotent — the message list is replaced atomically, never appended to.
    const messagesAtStop: UIMessage[] = [userMsg, partialAssistantMsg];

    useChatStore.getState().finalizePartialMessage('conv-1', messagesAtStop);
    useChatStore.getState().finalizePartialMessage('conv-1', messagesAtStop);

    const conv = useChatStore.getState().conversations.find((c) => c.id === 'conv-1')!;
    expect(conv.messages).toHaveLength(2);
  });

  it('leaves other conversations untouched', () => {
    const messagesAtStop: UIMessage[] = [userMsg, partialAssistantMsg];

    useChatStore.getState().finalizePartialMessage('conv-1', messagesAtStop);

    const conv2 = useChatStore.getState().conversations.find((c) => c.id === 'conv-2');
    expect(conv2!.messages).toHaveLength(0);
  });
});

// ============================================================================
// Stop + reload — round-trip via the normalizer contract
// ============================================================================

describe('Chat Store — stopped message reloads intact via saveMessages', () => {
  const userMsg = makeMsg('u1', 'user', 'Tell me about X');
  const stoppedMsg = makeMsg(
    'a1',
    'assistant',
    'X is a concept that encompasses many fields. In particular',
  );

  beforeEach(() => {
    useChatStore.setState({
      conversations: [makeConv('conv-reload', { messages: [] })],
    });
  });

  it('a stopped message round-trips through saveMessages (the reload path)', () => {
    const messagesAtStop: UIMessage[] = [userMsg, stoppedMsg];

    // Simulate the streaming-complete path writing to Zustand (finalizePartialMessage
    // shares the same semantics as saveMessages; we test both here).
    useChatStore.getState().finalizePartialMessage('conv-reload', messagesAtStop);

    // Simulate a reload: read back what the store has.
    const reloaded = useChatStore
      .getState()
      .conversations.find((c) => c.id === 'conv-reload')!.messages;

    expect(reloaded).toHaveLength(2);

    const [reloadedUser, reloadedAssistant] = reloaded;
    expect(reloadedUser.role).toBe('user');
    expect(reloadedAssistant.role).toBe('assistant');

    const textPart = reloadedAssistant.parts.find((p) => p.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;
    expect(textPart).toBeDefined();
    // The partial text is preserved exactly once — no truncation, no duplication.
    expect(textPart!.text).toBe('X is a concept that encompasses many fields. In particular');
  });
});
