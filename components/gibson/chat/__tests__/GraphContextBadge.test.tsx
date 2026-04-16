import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GraphContextBadge } from '../GraphContextBadge';
import type { GraphContext } from '@/src/stores/chat-store';

const mockContext: GraphContext = {
  nodeId: 'node-123',
  nodeType: 'Host',
  nodeLabel: '10.0.0.1',
};

describe('GraphContextBadge', () => {
  it('renders the node type and label', () => {
    render(
      <GraphContextBadge context={mockContext} onDismiss={vi.fn()} />,
    );

    expect(screen.getByText(/Host/)).toBeDefined();
    expect(screen.getByText(/10\.0\.0\.1/)).toBeDefined();
  });

  it('calls onDismiss when the dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <GraphContextBadge context={mockContext} onDismiss={onDismiss} />,
    );

    const dismissBtn = screen.getByLabelText('Clear graph context');
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('falls back to Unknown when nodeLabel is missing', () => {
    const context: GraphContext = { nodeId: 'node-456' };
    render(
      <GraphContextBadge context={context} onDismiss={vi.fn()} />,
    );

    expect(screen.getByText(/Node/)).toBeDefined();
  });
});
