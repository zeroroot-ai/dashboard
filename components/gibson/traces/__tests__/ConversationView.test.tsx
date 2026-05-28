/**
 * Contract test for ConversationView — the readable prompt ↔ response renderer
 * at the heart of the Gibson Traces viewer (dashboard#466).
 *
 * Asserts external rendering behaviour against the ConversationMessage[] shape:
 * role rendering, system-prompt collapse, markdown on assistant content, tool
 * calls + results, and the generation token chip. Not internal state.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConversationView } from '../ConversationView';
import type { ConversationMessage } from '@/src/types/trace';

describe('ConversationView', () => {
  it('renders an empty-state line when there are no messages', () => {
    render(<ConversationView messages={[]} />);
    expect(screen.getByText(/No conversation content recorded/i)).toBeDefined();
  });

  it('renders a user message as a plain bubble', () => {
    const messages: ConversationMessage[] = [
      { role: 'user', content: 'scan the host' },
    ];
    render(<ConversationView messages={messages} />);
    expect(screen.getByText('scan the host')).toBeDefined();
    expect(screen.getByText('User')).toBeDefined();
  });

  it('renders assistant content as markdown', () => {
    const messages: ConversationMessage[] = [
      { role: 'assistant', content: '**bold** answer' },
    ];
    const { container } = render(<ConversationView messages={messages} />);
    const strong = container.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('bold');
  });

  it('collapses the system prompt by default and reveals it on toggle', () => {
    const messages: ConversationMessage[] = [
      { role: 'system', content: 'YOU ARE A PENTESTER SYSTEM PROMPT' },
    ];
    render(<ConversationView messages={messages} />);

    // Trigger is always visible; the prompt body is collapsed (unmounted).
    const trigger = screen.getByText('System prompt');
    expect(trigger).toBeDefined();
    expect(
      screen.queryByText('YOU ARE A PENTESTER SYSTEM PROMPT'),
    ).toBeNull();

    fireEvent.click(trigger);

    expect(
      screen.getByText('YOU ARE A PENTESTER SYSTEM PROMPT'),
    ).toBeDefined();
  });

  it('renders tool calls inline beneath the assistant message', () => {
    const messages: ConversationMessage[] = [
      {
        role: 'assistant',
        content: 'Running a scan.',
        toolCalls: [{ id: 'c1', name: 'nmap', arguments: '{"host":"10.0.0.1"}' }],
      },
    ];
    render(<ConversationView messages={messages} />);
    expect(screen.getByText('nmap')).toBeDefined();
  });

  it('renders a tool result as a labelled collapsible block', () => {
    const messages: ConversationMessage[] = [
      { role: 'tool', content: '{"ports":[80,443]}', toolCallId: 'c1' },
    ];
    render(<ConversationView messages={messages} />);
    expect(screen.getByText(/Tool result/)).toBeDefined();
    expect(screen.getByText(/c1/)).toBeDefined();
  });

  it('shows the token chip when generation tokens are supplied', () => {
    const messages: ConversationMessage[] = [
      { role: 'assistant', content: 'done' },
    ];
    render(<ConversationView messages={messages} tokens={{ input: 1200, output: 480 }} />);

    const chip = screen.getByTestId('conversation-tokens');
    expect(chip).toBeDefined();
    expect(chip.textContent).toContain('1.2k');
    expect(chip.textContent).toContain('480');
  });

  it('omits the token chip when no tokens are supplied', () => {
    const messages: ConversationMessage[] = [
      { role: 'assistant', content: 'done' },
    ];
    render(<ConversationView messages={messages} />);
    expect(screen.queryByTestId('conversation-tokens')).toBeNull();
  });

  it('omits the token chip when both token counts are zero', () => {
    const messages: ConversationMessage[] = [
      { role: 'assistant', content: 'done' },
    ];
    render(<ConversationView messages={messages} tokens={{ input: 0, output: 0 }} />);
    expect(screen.queryByTestId('conversation-tokens')).toBeNull();
  });
});
