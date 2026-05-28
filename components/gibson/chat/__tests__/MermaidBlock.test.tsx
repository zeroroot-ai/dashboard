/**
 * Tests for MermaidBlock.
 *
 * Covers:
 * - Valid Mermaid syntax → renders a div containing the SVG output
 * - Invalid Mermaid syntax → falls back to <pre><code> with raw source
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ============================================================================
// Mock mermaid — must be declared before the component import
// ============================================================================

const mockRender = vi.fn();

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: mockRender,
  },
}));

// Dynamic import is used inside MermaidBlock. We need to ensure vitest
// resolves the mock for `mermaid` when the component calls
// `import('mermaid')`. The vi.mock hoisting takes care of this.

import { MermaidBlock } from '../MermaidBlock';

// ============================================================================
// Tests
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MermaidBlock', () => {
  describe('valid mermaid source', () => {
    it('renders a div with the SVG content returned by mermaid.render', async () => {
      const fakeSvg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>';
      mockRender.mockResolvedValueOnce({ svg: fakeSvg });

      const { container } = render(
        <MermaidBlock code="graph TD; A-->B;" />,
      );

      // Wait for the async mermaid.render to complete and innerHTML to be set.
      // jsdom normalises SVG (self-closing tags → explicit close tags), so we
      // check for the SVG element's presence rather than exact string equality.
      await waitFor(() => {
        const wrapper = container.querySelector('[aria-label="Mermaid diagram"]');
        expect(wrapper).not.toBeNull();
        expect(wrapper!.querySelector('svg')).not.toBeNull();
      });

      // The fallback <pre> must NOT be present for a successful render.
      const pre = container.querySelector('pre');
      expect(pre).toBeNull();
    });
  });

  describe('invalid mermaid source', () => {
    it('falls back to <pre><code> with the raw source when mermaid.render throws', async () => {
      mockRender.mockRejectedValueOnce(new Error('Parse error'));

      const invalidCode = 'this is not valid mermaid syntax ###';
      render(<MermaidBlock code={invalidCode} />);

      // Wait for the error state to be set and the fallback to render.
      await waitFor(() => {
        expect(screen.getByText(invalidCode)).toBeInTheDocument();
      });

      const pre = screen.getByText(invalidCode).closest('pre');
      expect(pre).not.toBeNull();

      const code = screen.getByText(invalidCode).closest('code');
      expect(code).not.toBeNull();
    });
  });
});
