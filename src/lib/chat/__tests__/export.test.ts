/**
 * Chat export utility tests
 */

import { describe, it, expect } from 'vitest';
import {
  conversationToMarkdown,
  conversationToPlaintext,
  titleToFilename,
} from '../export';
import type { Conversation } from '@/src/stores/chat-store';
import type { UIMessage } from 'ai';

function makeMsg(role: UIMessage['role'], text: string): UIMessage {
  return {
    id: `msg-${Math.random()}`,
    role,
    parts: [{ type: 'text', text }],
    createdAt: new Date('2026-01-01T00:00:00Z'),
  } as UIMessage;
}

const base: Conversation = {
  id: 'test-conv',
  agentId: 'general',
  messages: [makeMsg('user', 'Hello'), makeMsg('assistant', 'Hi there')],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  lastMessageAt: new Date('2026-01-01T00:01:00Z'),
  title: 'Test Chat',
};

describe('conversationToMarkdown', () => {
  it('starts with a level-1 heading matching the title', () => {
    const md = conversationToMarkdown(base);
    expect(md).toMatch(/^# Test Chat\n/);
  });

  it('includes user and assistant messages', () => {
    const md = conversationToMarkdown(base);
    expect(md).toContain('**User**');
    expect(md).toContain('Hello');
    expect(md).toContain('**Assistant**');
    expect(md).toContain('Hi there');
  });

  it('skips system messages', () => {
    const conv: Conversation = {
      ...base,
      messages: [makeMsg('system', 'You are a helpful AI.'), ...base.messages],
    };
    const md = conversationToMarkdown(conv);
    expect(md).not.toContain('You are a helpful AI.');
    expect(md).not.toContain('**System**');
  });

  it('falls back to "Conversation" when title is absent', () => {
    const conv: Conversation = { ...base, title: undefined };
    const md = conversationToMarkdown(conv);
    expect(md).toMatch(/^# Conversation\n/);
  });

  it('skips messages with no text parts', () => {
    const emptyMsg = {
      id: 'empty',
      role: 'user',
      parts: [],
      createdAt: new Date(),
    } as unknown as UIMessage;
    const conv: Conversation = { ...base, messages: [emptyMsg] };
    const md = conversationToMarkdown(conv);
    expect(md).not.toContain('**User**');
  });
});

describe('conversationToPlaintext', () => {
  it('starts with the title on the first line', () => {
    const txt = conversationToPlaintext(base);
    expect(txt).toMatch(/^Test Chat\n/);
  });

  it('includes role labels with colon', () => {
    const txt = conversationToPlaintext(base);
    expect(txt).toContain('User:');
    expect(txt).toContain('Assistant:');
  });

  it('includes message content', () => {
    const txt = conversationToPlaintext(base);
    expect(txt).toContain('Hello');
    expect(txt).toContain('Hi there');
  });

  it('skips system messages', () => {
    const conv: Conversation = {
      ...base,
      messages: [makeMsg('system', 'System context.'), ...base.messages],
    };
    const txt = conversationToPlaintext(conv);
    expect(txt).not.toContain('System context.');
  });
});

describe('titleToFilename', () => {
  it('lowercases and hyphenates the title', () => {
    expect(titleToFilename('My Chat')).toBe('my-chat');
  });

  it('removes leading/trailing hyphens', () => {
    expect(titleToFilename('--test--')).toBe('test');
  });

  it('truncates to 60 characters', () => {
    const long = 'a'.repeat(100);
    expect(titleToFilename(long)).toHaveLength(60);
  });

  it('falls back to "conversation" when title is empty', () => {
    expect(titleToFilename('')).toBe('conversation');
  });
});
