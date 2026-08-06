/**
 * Tests for MermaidBlock.
 *
 * Covers:
 * - Valid Mermaid syntax → renders a div containing the SVG output
 * - Invalid Mermaid syntax → falls back to <pre><code> with raw source
 * - Security: securityLevel is pinned, and the SVG is sanitised before it is
 *   assigned to innerHTML (GHSA-xxg9-2h3v-588p)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ============================================================================
// Mock mermaid, must be declared before the component import
// ============================================================================

const mockRender = vi.fn();
const mockInitialize = vi.fn();

vi.mock('mermaid', () => ({
  default: {
    initialize: mockInitialize,
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

  // ==========================================================================
  // Security (GHSA-xxg9-2h3v-588p)
  //
  // The diagram source reaching this component is attacker-influenceable: an
  // assistant message is downstream of tool output, retrieved documents and
  // findings. Two independent controls must hold.
  // ==========================================================================

  describe('security', () => {
    it('pins securityLevel to strict rather than inheriting the mermaid default', async () => {
      mockRender.mockResolvedValueOnce({ svg: '<svg></svg>' });

      render(<MermaidBlock code="graph TD; A-->B;" />);

      await waitFor(() => {
        expect(mockInitialize).toHaveBeenCalled();
      });
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({ securityLevel: 'strict' }),
      );
    });

    it('disables HTML labels so no HTML subtree is emitted into the diagram', async () => {
      mockRender.mockResolvedValueOnce({ svg: '<svg></svg>' });

      render(<MermaidBlock code="graph TD; A-->B;" />);

      await waitFor(() => {
        expect(mockInitialize).toHaveBeenCalled();
      });
      expect(mockInitialize).toHaveBeenCalledWith(
        expect.objectContaining({
          flowchart: { htmlLabels: false },
          class: { htmlLabels: false },
        }),
      );
    });

    it('strips an injected script element from the rendered SVG', async () => {
      mockRender.mockResolvedValueOnce({
        svg:
          '<svg xmlns="http://www.w3.org/2000/svg">' +
          '<script>window.__mermaidPwned = true;</script>' +
          '<circle r="10"/></svg>',
      });

      const { container } = render(<MermaidBlock code="graph TD; A-->B;" />);

      await waitFor(() => {
        expect(container.querySelector('svg')).not.toBeNull();
      });

      expect(container.querySelector('script')).toBeNull();
      expect(container.innerHTML).not.toContain('__mermaidPwned');
      expect(
        (window as unknown as Record<string, unknown>).__mermaidPwned,
      ).toBeUndefined();
    });

    it('strips inline event handlers from the rendered SVG', async () => {
      mockRender.mockResolvedValueOnce({
        svg:
          '<svg xmlns="http://www.w3.org/2000/svg">' +
          '<circle r="10" onload="window.__mermaidPwned = true" ' +
          'onclick="window.__mermaidPwned = true"/>' +
          '<image href="x" onerror="window.__mermaidPwned = true"/></svg>',
      });

      const { container } = render(<MermaidBlock code="graph TD; A-->B;" />);

      await waitFor(() => {
        expect(container.querySelector('svg')).not.toBeNull();
      });

      const circle = container.querySelector('circle');
      expect(circle).not.toBeNull();
      expect(circle!.getAttribute('onload')).toBeNull();
      expect(circle!.getAttribute('onclick')).toBeNull();
      expect(container.innerHTML).not.toContain('__mermaidPwned');
    });

    it('strips a javascript: link that a click directive would produce', async () => {
      mockRender.mockResolvedValueOnce({
        svg:
          '<svg xmlns="http://www.w3.org/2000/svg">' +
          '<a href="javascript:window.__mermaidPwned=true">' +
          '<text>node</text></a></svg>',
      });

      const { container } = render(<MermaidBlock code="graph TD; A-->B;" />);

      await waitFor(() => {
        expect(container.querySelector('svg')).not.toBeNull();
      });

      const anchor = container.querySelector('a');
      expect(anchor?.getAttribute('href') ?? '').not.toContain('javascript:');
      expect(container.innerHTML).not.toContain('__mermaidPwned');
    });

    // With htmlLabels disabled, mermaid never emits a foreignObject, so any
    // HTML nested in one is by definition not ours. The sanitiser drops it.
    it('drops HTML smuggled inside a foreignObject', async () => {
      mockRender.mockResolvedValueOnce({
        svg:
          '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="80" height="20">' +
          '<div xmlns="http://www.w3.org/1999/xhtml">label' +
          '<iframe src="javascript:window.__mermaidPwned=true"></iframe></div>' +
          '</foreignObject></svg>',
      });

      const { container } = render(<MermaidBlock code="graph TD; A-->B;" />);

      await waitFor(() => {
        expect(container.querySelector('svg')).not.toBeNull();
      });

      expect(container.querySelector('iframe')).toBeNull();
      expect(container.querySelector('svg div')).toBeNull();
      expect(container.innerHTML).not.toContain('__mermaidPwned');
    });

    it('keeps the diagram markup a real mermaid render depends on', async () => {
      mockRender.mockResolvedValueOnce({
        svg:
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
          '<style>.node rect { stroke-width: 2px; }</style>' +
          '<g class="node"><rect x="1" y="2" width="10" height="5"/>' +
          '<path d="M0 0 L10 10" marker-end="url(#arrow)"/>' +
          '<text x="3" y="4">label</text></g></svg>',
      });

      const { container } = render(<MermaidBlock code="graph TD; A-->B;" />);

      await waitFor(() => {
        expect(container.querySelector('svg')).not.toBeNull();
      });

      expect(container.querySelector('style')).not.toBeNull();
      expect(container.querySelector('g.node rect')).not.toBeNull();
      expect(container.querySelector('path')?.getAttribute('d')).toBe('M0 0 L10 10');
      expect(container.textContent).toContain('label');
    });
  });
});
