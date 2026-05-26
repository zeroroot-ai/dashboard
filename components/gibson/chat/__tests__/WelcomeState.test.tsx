import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WelcomeState } from '../WelcomeState';
import type { ChatAgent } from '@/src/stores/chat-store';

const mockAgent: ChatAgent = {
  id: 'general',
  name: 'General Assistant',
  description: 'General purpose assistant for questions',
  status: 'online',
  capabilities: ['general'],
  icon: 'bot',
};

const mockGraphSummary = {
  summary: 'Some summary text',
  stats: { hosts: 42, services: 100, findings: 15, vulnerabilities: 5, missions: 3 },
};

describe('WelcomeState', () => {
  it('renders the agent name', () => {
    render(
      <WelcomeState agent={mockAgent} graphSummary={null} onSendPrompt={vi.fn()} />,
    );

    expect(screen.getByText('Chat with General Assistant')).toBeDefined();
  });

  it('renders the agent description', () => {
    render(
      <WelcomeState agent={mockAgent} graphSummary={null} onSendPrompt={vi.fn()} />,
    );

    expect(screen.getByText('General purpose assistant for questions')).toBeDefined();
  });

  it('renders graph stats when available', () => {
    render(
      <WelcomeState agent={mockAgent} graphSummary={mockGraphSummary} onSendPrompt={vi.fn()} />,
    );

    const statsText = screen.getByText(/42 hosts/);
    expect(statsText).toBeDefined();
    expect(statsText.textContent).toContain('15 findings');
    expect(statsText.textContent).toContain('3 missions');
  });

  it('does not render graph stats when summary is null', () => {
    render(
      <WelcomeState agent={mockAgent} graphSummary={null} onSendPrompt={vi.fn()} />,
    );

    // Use a specific regex that matches the stats paragraph (e.g. "42 hosts") but not
    // the suggested prompt button "What hosts have critical vulnerabilities?"
    expect(screen.queryByText(/\d+ hosts/)).toBeNull();
  });

  it('renders suggested prompts', () => {
    render(
      <WelcomeState agent={mockAgent} graphSummary={null} onSendPrompt={vi.fn()} />,
    );

    expect(screen.getByText('Summarize my latest mission findings')).toBeDefined();
    expect(screen.getByText('What hosts have critical vulnerabilities?')).toBeDefined();
  });

  it('calls onSendPrompt when a suggestion is clicked', () => {
    const onSendPrompt = vi.fn();
    render(
      <WelcomeState agent={mockAgent} graphSummary={null} onSendPrompt={onSendPrompt} />,
    );

    fireEvent.click(screen.getByText('Summarize my latest mission findings'));
    expect(onSendPrompt).toHaveBeenCalledWith('Summarize my latest mission findings');
  });
});
