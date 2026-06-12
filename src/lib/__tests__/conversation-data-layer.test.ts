/**
 * Dashboard data-layer tests for the conversation persistence cutover.
 *
 * Tests (dashboard#549 acceptance criteria):
 *   1. hydrate-from-daemon: RPC records map to UI Conversation shapes
 *   2. save-on-completion: saveConversationAction calls saveConversation RPC
 *      with the correctly mapped payload shape
 *   3. store-unavailable: when the daemon is unreachable the action returns
 *      false (not a silent empty list masking the error)
 *
 * spec: chat-conversation-persistence (dashboard#548/#549)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks, must precede subject import. Use vi.hoisted() to lift variables
// above the hoisted vi.mock() factory calls.
// ---------------------------------------------------------------------------

const { mockSaveConversationRpc, mockGetServerSession, mockListConversationsRpc, mockLogger } =
  vi.hoisted(() => ({
    mockSaveConversationRpc: vi.fn(),
    mockGetServerSession: vi.fn(),
    mockListConversationsRpc: vi.fn(),
    mockLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  }));

vi.mock('server-only', () => ({}));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock('@/src/lib/gibson-client', async (importActual) => {
  const actual = await importActual<typeof import('@/src/lib/gibson-client')>();
  return {
    ...actual,
    saveConversation: mockSaveConversationRpc,
    listConversations: mockListConversationsRpc,
  };
});

vi.mock('@/src/lib/logger', () => ({
  logger: mockLogger,
}));

// Prevent generateConversationTitle from making real LLM calls.
vi.mock('@/src/lib/ai/provider', () => ({
  resolveProvider: vi.fn(),
}));
vi.mock('ai', () => ({ generateText: vi.fn() }));

// ---------------------------------------------------------------------------
// Subject under test.
// ---------------------------------------------------------------------------

import { saveConversationAction } from '@/app/actions/chat';
import { listConversations, type ConversationRecord } from '@/src/lib/gibson-client';
import type { UIMessage } from 'ai';

// ---------------------------------------------------------------------------
// Test 1, hydrate-from-daemon: RPC records map to UI Conversation shapes
// ---------------------------------------------------------------------------

describe('hydrate-from-daemon: listConversations maps RPC records', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps ConversationRecord fields to expected UI shape', async () => {
    const nowUnix = 1_700_000_000;
    const rpcRecord: ConversationRecord = {
      id: 'conv-abc',
      tenantId: 'tenant-1',
      userId: 'user-1',
      title: 'My Conversation',
      createdAt: new Date(nowUnix * 1000).toISOString(),
      updatedAt: new Date((nowUnix + 60) * 1000).toISOString(),
      messageCount: 3,
    };

    mockListConversationsRpc.mockResolvedValueOnce([rpcRecord]);

    const result = await listConversations(50);

    expect(result).toHaveLength(1);
    const [r] = result;
    expect(r.id).toBe('conv-abc');
    expect(r.title).toBe('My Conversation');
    expect(r.tenantId).toBe('tenant-1');
    expect(r.userId).toBe('user-1');
    expect(r.messageCount).toBe(3);
    expect(r.createdAt).toBe(rpcRecord.createdAt);
    expect(r.updatedAt).toBe(rpcRecord.updatedAt);
  });

  it('returns an empty array when there are no conversations', async () => {
    mockListConversationsRpc.mockResolvedValueOnce([]);
    const result = await listConversations(50);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Test 2, save-on-completion: saveConversationAction calls the RPC with
//   the correct mapped shape
// ---------------------------------------------------------------------------

describe('save-on-completion: saveConversationAction calls SaveConversation RPC', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', tenantId: 'tenant-1' },
    });
    mockSaveConversationRpc.mockResolvedValue(undefined);
  });

  it('calls saveConversation with parts-based payload and returns true on success', async () => {
    const messages: UIMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Hello' }],
      },
      {
        id: 'msg-2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'Hi there' }],
      },
    ];

    const result = await saveConversationAction('conv-xyz', 'Test Chat', messages, 'agent-general');

    expect(result).toBe(true);
    expect(mockSaveConversationRpc).toHaveBeenCalledOnce();

    const [convId, title, mappedMessages, agentId] =
      mockSaveConversationRpc.mock.calls[0] as [string, string, Array<{ id: string; role: string; parts: unknown[] }>, string];
    expect(convId).toBe('conv-xyz');
    expect(title).toBe('Test Chat');
    expect(agentId).toBe('agent-general');
    expect(mappedMessages).toHaveLength(2);
    expect(mappedMessages[0].role).toBe('user');
    expect(mappedMessages[1].role).toBe('assistant');
    // The normalizer converts text parts to proto MessagePartText.
    expect(mappedMessages[0].parts).toHaveLength(1);
    expect(mappedMessages[1].parts).toHaveLength(1);
  });

  it('maps UIMessage text part to proto parts (dashboard#550: parts-based, not flat content)', async () => {
    const messages: UIMessage[] = [
      {
        id: 'msg-1',
        role: 'user',
        parts: [{ type: 'text', text: 'Plain text message' }],
      },
    ];

    await saveConversationAction('conv-1', 'Title', messages);

    const [, , mappedMessages] =
      mockSaveConversationRpc.mock.calls[0] as [string, string, Array<{ parts: Array<{ part?: { case?: string; value?: { text?: string } } }> }>];
    // proto MessagePartText has part.case === 'text' and part.value.text
    const part = mappedMessages[0].parts[0];
    expect(part?.part?.case).toBe('text');
    expect(part?.part?.value?.text).toBe('Plain text message');
  });

  it('returns false when the session is absent', async () => {
    mockGetServerSession.mockResolvedValueOnce(null);

    const messages: UIMessage[] = [
      { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
    ];

    const result = await saveConversationAction('conv-1', 'Title', messages);

    expect(result).toBe(false);
    expect(mockSaveConversationRpc).not.toHaveBeenCalled();
  });

  it('returns false when messages array is empty', async () => {
    const result = await saveConversationAction('conv-1', 'Title', []);
    expect(result).toBe(false);
    expect(mockSaveConversationRpc).not.toHaveBeenCalled();
  });

  it('returns false when conversationId is empty string', async () => {
    const messages: UIMessage[] = [
      { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
    ];
    const result = await saveConversationAction('', 'Title', messages);
    expect(result).toBe(false);
    expect(mockSaveConversationRpc).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 3, store-unavailable: RPC failure returns false (explicit error
//   state, not a silent empty list that masquerades as data loss)
// ---------------------------------------------------------------------------

describe('store-unavailable: RPC failure surfaces an error state, not a silent empty list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue({
      user: { id: 'user-1', tenantId: 'tenant-1' },
    });
  });

  it('returns false when the daemon throws codes.Unavailable', async () => {
    const rpcError = Object.assign(new Error('upstream connect error'), {
      code: 'unavailable',
    });
    mockSaveConversationRpc.mockRejectedValueOnce(rpcError);

    const msgs: UIMessage[] = [
      { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
    ];
    const result = await saveConversationAction('conv-1', 'Title', msgs);

    // Must be false, NOT a thrown exception (which would crash the client)
    // and NOT silent (which would make it look like a successful save).
    expect(result).toBe(false);
  });

  it('returns false when the daemon throws codes.Internal (misconfigured store)', async () => {
    const rpcError = Object.assign(new Error('conversation store not wired'), {
      code: 'internal',
    });
    mockSaveConversationRpc.mockRejectedValueOnce(rpcError);

    const msgs: UIMessage[] = [
      { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
    ];
    const result = await saveConversationAction('conv-1', 'Title', msgs);

    expect(result).toBe(false);
  });

  it('does not swallow the error silently, a warn log is emitted', async () => {
    const rpcError = new Error('connection refused');
    mockSaveConversationRpc.mockRejectedValueOnce(rpcError);

    const msgs: UIMessage[] = [
      { id: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
    ];
    await saveConversationAction('conv-1', 'Title', msgs);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: rpcError, conversationId: 'conv-1' }),
      expect.stringContaining('saveConversationAction'),
    );
  });
});
