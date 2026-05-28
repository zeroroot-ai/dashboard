/**
 * Unit tests for GraphCitationChip component.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';

// ---------------------------------------------------------------------------
// Mock next/link — jsdom has no routing, so render a plain <a>
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { GraphCitationChip } from '../GraphCitationChip';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraphCitationChip', () => {
  it('renders a link pointing to the graph explorer for the given nodeId', () => {
    render(<GraphCitationChip nodeId="host:10.0.0.1" />);
    const link = screen.getByRole('link');
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('/dashboard/graph?nodeId=host%3A10.0.0.1');
  });

  it('displays "Source: {nodeId}" for short node IDs (≤20 chars)', () => {
    render(<GraphCitationChip nodeId="domain:acme.com" />);
    expect(screen.getByText('Source: domain:acme.com')).toBeDefined();
  });

  it('truncates nodeIds longer than 20 characters with an ellipsis', () => {
    const longId = 'host:very-long-hostname.example.com';
    render(<GraphCitationChip nodeId={longId} />);
    // Should be truncated to 20 chars + ellipsis
    const expected = `Source: ${longId.slice(0, 20)}…`;
    expect(screen.getByText(expected)).toBeDefined();
  });

  it('does not truncate nodeIds that are exactly 20 characters', () => {
    // Exactly 20 chars
    const exactId = '12345678901234567890';
    render(<GraphCitationChip nodeId={exactId} />);
    expect(screen.getByText(`Source: ${exactId}`)).toBeDefined();
  });

  it('renders a link with semantic token classes (no hardcoded colors)', () => {
    const { container } = render(<GraphCitationChip nodeId="finding:f-001" />);
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    // Must use semantic tokens, not palette utilities
    expect(link!.className).toContain('bg-muted');
    expect(link!.className).toContain('text-muted-foreground');
  });
});
