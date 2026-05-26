import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AgentSelector } from '../AgentSelector';
import type { ChatAgent } from '@/src/stores/chat-store';

/** Open the RadixUI dropdown trigger (requires pointerdown before click). */
function openDropdown(triggerEl: HTMLElement) {
  fireEvent.pointerDown(triggerEl, { button: 0 });
  fireEvent.click(triggerEl);
}

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
    status: 'busy',
    capabilities: ['recon'],
    icon: 'search',
  },
  {
    id: 'exploit',
    name: 'Exploit Agent',
    description: 'Exploitation analyst',
    status: 'offline',
    capabilities: ['exploit'],
    icon: 'zap',
  },
];

describe('AgentSelector', () => {
  it('renders the selected agent name', () => {
    render(
      <AgentSelector agents={mockAgents} selectedId="general" onSelect={vi.fn()} />,
    );

    expect(screen.getByText('General Assistant')).toBeDefined();
  });

  it('shows all agents when dropdown is opened', async () => {
    render(
      <AgentSelector agents={mockAgents} selectedId="general" onSelect={vi.fn()} />,
    );

    // Open the dropdown — Radix requires pointerdown before click to change state
    const trigger = screen.getByRole('button');
    openDropdown(trigger);

    // All agents should be visible in the portal
    expect(screen.getByText('Reconnaissance Agent')).toBeDefined();
    expect(screen.getByText('Exploit Agent')).toBeDefined();
  });

  it('calls onSelect when an agent is clicked', async () => {
    const onSelect = vi.fn();
    render(
      <AgentSelector agents={mockAgents} selectedId="general" onSelect={onSelect} />,
    );

    openDropdown(screen.getByRole('button'));
    fireEvent.click(screen.getByText('Reconnaissance Agent'));

    expect(onSelect).toHaveBeenCalledWith('recon');
  });

  it('displays agent descriptions', () => {
    render(
      <AgentSelector agents={mockAgents} selectedId="general" onSelect={vi.fn()} />,
    );

    openDropdown(screen.getByRole('button'));

    expect(screen.getByText('Recon specialist')).toBeDefined();
    expect(screen.getByText('Exploitation analyst')).toBeDefined();
  });
});
