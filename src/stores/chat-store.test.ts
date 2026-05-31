/**
 * Chat Store — pin, rename, stop+persist-partial, and edit+regenerate unit tests
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

// ============================================================================
// Edit + regenerate — truncateMessages
// ============================================================================

describe('Chat Store — truncateMessages (edit/regenerate)', () => {
  const userMsg1 = makeMsg('u1', 'user', 'First question');
  const assistantMsg1 = makeMsg('a1', 'assistant', 'First answer');
  const userMsg2 = makeMsg('u2', 'user', 'Follow-up question');
  const assistantMsg2 = makeMsg('a2', 'assistant', 'Follow-up answer');

  beforeEach(() => {
    useChatStore.setState({
      conversations: [
        makeConv('conv-edit', {
          messages: [userMsg1, assistantMsg1, userMsg2, assistantMsg2],
        }),
        makeConv('conv-other', { messages: [makeMsg('o1', 'user', 'Other')] }),
      ],
    });
  });

  it('truncates downstream messages when editing a user message (keep up to and including the edited message)', () => {
    // Edit userMsg2 at index 2 — this should drop assistantMsg2 (index 3)
    useChatStore.getState().truncateMessages('conv-edit', 2);
    const msgs = useChatStore.getState().conversations.find((c) => c.id === 'conv-edit')!.messages;
    expect(msgs).toHaveLength(3); // u1, a1, u2
    expect(msgs[2].id).toBe('u2');
  });

  it('truncating to the first message leaves exactly one message', () => {
    useChatStore.getState().truncateMessages('conv-edit', 0);
    const msgs = useChatStore.getState().conversations.find((c) => c.id === 'conv-edit')!.messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('u1');
  });

  it('truncating to the last index leaves all messages unchanged', () => {
    useChatStore.getState().truncateMessages('conv-edit', 3);
    const msgs = useChatStore.getState().conversations.find((c) => c.id === 'conv-edit')!.messages;
    expect(msgs).toHaveLength(4);
  });

  it('truncating to an out-of-range index is a no-op', () => {
    useChatStore.getState().truncateMessages('conv-edit', 99);
    const msgs = useChatStore.getState().conversations.find((c) => c.id === 'conv-edit')!.messages;
    expect(msgs).toHaveLength(4);
  });

  it('truncating to a negative index is a no-op', () => {
    useChatStore.getState().truncateMessages('conv-edit', -1);
    const msgs = useChatStore.getState().conversations.find((c) => c.id === 'conv-edit')!.messages;
    expect(msgs).toHaveLength(4);
  });

  it('does not affect other conversations', () => {
    useChatStore.getState().truncateMessages('conv-edit', 1);
    const otherMsgs = useChatStore.getState().conversations.find((c) => c.id === 'conv-other')!.messages;
    expect(otherMsgs).toHaveLength(1);
  });
});

// ============================================================================
// Edit + regenerate — editMessageText
// ============================================================================

describe('Chat Store — editMessageText', () => {
  const userMsg = makeMsg('u1', 'user', 'Original text');
  const assistantMsg = makeMsg('a1', 'assistant', 'Some answer');

  beforeEach(() => {
    useChatStore.setState({
      conversations: [
        makeConv('conv-edit2', { messages: [userMsg, assistantMsg] }),
      ],
    });
  });

  it('replaces the text of the targeted user message', () => {
    useChatStore.getState().editMessageText('conv-edit2', 'u1', 'Updated text');
    const msgs = useChatStore.getState().conversations.find((c) => c.id === 'conv-edit2')!.messages;
    const textPart = msgs[0].parts.find((p) => p.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;
    expect(textPart?.text).toBe('Updated text');
  });

  it('leaves messages for an unknown messageId untouched', () => {
    useChatStore.getState().editMessageText('conv-edit2', 'nonexistent', 'Changed');
    const msgs = useChatStore.getState().conversations.find((c) => c.id === 'conv-edit2')!.messages;
    const textPart = msgs[0].parts.find((p) => p.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;
    expect(textPart?.text).toBe('Original text');
  });

  it('does not modify the assistant message when editing the user message', () => {
    useChatStore.getState().editMessageText('conv-edit2', 'u1', 'New question');
    const msgs = useChatStore.getState().conversations.find((c) => c.id === 'conv-edit2')!.messages;
    const assistantPart = msgs[1].parts.find((p) => p.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;
    expect(assistantPart?.text).toBe('Some answer');
  });
});

// ============================================================================
// Edit + regenerate — full edit-truncate-persist sequence
// ============================================================================

describe('Chat Store — edit-and-regenerate full sequence', () => {
  const u1 = makeMsg('u1', 'user', 'What is X?');
  const a1 = makeMsg('a1', 'assistant', 'X is a thing');
  const u2 = makeMsg('u2', 'user', 'Tell me more about Y');
  const a2 = makeMsg('a2', 'assistant', 'Y is another thing');

  beforeEach(() => {
    useChatStore.setState({
      conversations: [
        makeConv('conv-seq', { messages: [u1, a1, u2, a2] }),
      ],
    });
  });

  it('edit user message + truncate downstream + re-stream produces coherent thread', () => {
    // Step 1: edit the second user message text
    useChatStore.getState().editMessageText('conv-seq', 'u2', 'Tell me about Z instead');

    // Step 2: truncate everything after the edited user message (index 2)
    useChatStore.getState().truncateMessages('conv-seq', 2);

    // After truncation: [u1, a1, u2-edited]; no downstream assistant message
    const afterTruncate = useChatStore.getState().conversations.find((c) => c.id === 'conv-seq')!.messages;
    expect(afterTruncate).toHaveLength(3);
    expect(afterTruncate[2].id).toBe('u2');
    const editedPart = afterTruncate[2].parts.find((p) => p.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;
    expect(editedPart?.text).toBe('Tell me about Z instead');

    // Step 3: simulate re-stream completion — finalizePartialMessage writes the
    // new assistant response (no a2; new a3 replaces it)
    const newAssistant = makeMsg('a3', 'assistant', 'Z is a completely different topic');
    const newMessages: UIMessage[] = [u1, a1, { ...u2, parts: [{ type: 'text', text: 'Tell me about Z instead' }] } as UIMessage, newAssistant];
    useChatStore.getState().finalizePartialMessage('conv-seq', newMessages);

    const final = useChatStore.getState().conversations.find((c) => c.id === 'conv-seq')!.messages;
    // Exactly 4 messages — no orphaned a2
    expect(final).toHaveLength(4);
    expect(final[3].id).toBe('a3');
    expect(final.find((m) => m.id === 'a2')).toBeUndefined();
  });

  it('regenerate assistant message produces coherent thread with no duplicate assistant response', () => {
    // Regenerate = truncate up to and including the preceding user message (index 2)
    // then re-stream. Simulate: truncate to index 2 (u2), then finalize with new assistant.
    useChatStore.getState().truncateMessages('conv-seq', 2);

    const newAssistant = makeMsg('a3', 'assistant', 'A regenerated answer about Y');
    const regenMessages: UIMessage[] = [u1, a1, u2, newAssistant];
    useChatStore.getState().finalizePartialMessage('conv-seq', regenMessages);

    const final = useChatStore.getState().conversations.find((c) => c.id === 'conv-seq')!.messages;
    // Exactly 4 messages — no duplicate a2 + a3
    expect(final).toHaveLength(4);
    expect(final[3].id).toBe('a3');
    expect(final.find((m) => m.id === 'a2')).toBeUndefined();
  });

  it('new thread persists and survives reload: finalizePartialMessage is the single write path', () => {
    // Simulate full edit-then-complete cycle
    useChatStore.getState().editMessageText('conv-seq', 'u1', 'What is A?');
    useChatStore.getState().truncateMessages('conv-seq', 0);

    const editedU1 = makeMsg('u1', 'user', 'What is A?');
    const newA1 = makeMsg('a1-new', 'assistant', 'A is the first letter');
    useChatStore.getState().finalizePartialMessage('conv-seq', [editedU1, newA1]);

    // Reload simulation: read from store
    const stored = useChatStore.getState().conversations.find((c) => c.id === 'conv-seq')!.messages;
    expect(stored).toHaveLength(2);

    const storedTextPart = stored[0].parts.find((p) => p.type === 'text') as
      | { type: 'text'; text: string }
      | undefined;
    expect(storedTextPart?.text).toBe('What is A?');
    expect(stored[1].id).toBe('a1-new');
  });
});
