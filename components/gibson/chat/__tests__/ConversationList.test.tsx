import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationList } from '../ConversationList';
import type { Conversation, ChatAgent } from '@/src/stores/chat-store';

const mockAgents: ChatAgent[] = [
  {
    id: 'general',
    name: 'General Assistant',
    description: 'General purpose assistant',
    status: 'online',
    capabilities: ['general'],
    icon: 'bot',
  },
  {
    id: 'recon',
    name: 'Reconnaissance Agent',
    description: 'Recon specialist',
    status: 'online',
    capabilities: ['recon'],
    icon: 'search',
  },
];

const mockConversations: Conversation[] = [
  {
    id: 'conv-1',
    agentId: 'general',
    messages: [],
    createdAt: new Date('2026-04-01T10:00:00'),
    lastMessageAt: new Date('2026-04-03T12:00:00'),
    title: 'Attack surface analysis',
  },
  {
    id: 'conv-2',
    agentId: 'recon',
    messages: [],
    createdAt: new Date('2026-04-02T10:00:00'),
    lastMessageAt: new Date('2026-04-03T14:00:00'),
    title: 'Port scan results',
  },
];

describe('ConversationList', () => {
  it('renders conversations sorted by most recent', () => {
    render(
      <ConversationList
        conversations={mockConversations}
        activeId={null}
        agents={mockAgents}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const items = screen.getAllByRole('button').filter(
      (btn) => btn.textContent?.includes('analysis') || btn.textContent?.includes('scan'),
    );
    // conv-2 is more recent, should appear first
    expect(items[0].textContent).toContain('Port scan results');
    expect(items[1].textContent).toContain('Attack surface analysis');
  });

  it('highlights the active conversation', () => {
    render(
      <ConversationList
        conversations={mockConversations}
        activeId="conv-1"
        agents={mockAgents}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const activeBtn = screen.getAllByRole('button').find(
      (btn) => btn.textContent?.includes('Attack surface analysis'),
    );
    expect(activeBtn?.className).toContain('bg-primary/10');
  });

  it('calls onSelect when a conversation is clicked', () => {
    const onSelect = vi.fn();
    render(
      <ConversationList
        conversations={mockConversations}
        activeId={null}
        agents={mockAgents}
        onSelect={onSelect}
        onNew={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    const convBtn = screen.getAllByRole('button').find(
      (btn) => btn.textContent?.includes('Port scan results'),
    );
    fireEvent.click(convBtn!);
    expect(onSelect).toHaveBeenCalledWith('conv-2');
  });

  it('calls onNew when New Chat button is clicked', () => {
    const onNew = vi.fn();
    render(
      <ConversationList
        conversations={mockConversations}
        activeId={null}
        agents={mockAgents}
        onSelect={vi.fn()}
        onNew={onNew}
        onDelete={vi.fn()}
      />,
    );

    const newChatBtn = screen.getByText('New Chat');
    fireEvent.click(newChatBtn);
    expect(onNew).toHaveBeenCalled();
  });

  it('shows empty state when no conversations', () => {
    render(
      <ConversationList
        conversations={[]}
        activeId={null}
        agents={mockAgents}
        onSelect={vi.fn()}
        onNew={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByText('No conversations yet')).toBeDefined();
  });
});
