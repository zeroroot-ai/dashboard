'use client';

/**
 * MermaidBlock, renders a Mermaid diagram inside an assistant message.
 *
 * Design constraints:
 * - Mermaid is dynamically imported so it never lands in the initial bundle.
 * - On parse/render error, falls back to a <pre><code> block showing raw source.
 * - All styling uses semantic design tokens only (no hardcoded colours).
 *
 * SECURITY
 * --------
 * The `code` this component renders is attacker-influenceable. It arrives in an
 * assistant message, and an assistant message is downstream of tool output,
 * retrieved documents and mission findings, none of which the platform authors.
 * The diagram source is therefore untrusted input, and the SVG mermaid produces
 * from it is untrusted output. Two controls, both required:
 *
 *  1. `securityLevel: 'strict'` on initialize. Mermaid's default is 'strict',
 *     but the default is not a contract, it has moved between major versions,
 *     and leaving it unpinned means a dependency bump can silently re-enable
 *     raw HTML in labels and `click` directives (which bind javascript: hrefs
 *     and call page-scope functions). Pin it.
 *  2. Sanitising the SVG before it is assigned to innerHTML. `strict` governs
 *     what mermaid *intends* to emit; DOMPurify governs what actually reaches
 *     the DOM, and covers mermaid parser bugs and any future default change.
 *
 * The previous comment here claimed DOMPurify "strips inline styles and scripts,
 * breaking the rendering", and so skipped it. Stripping scripts is the point.
 * Inline styles do survive: the SVG and SVG-filter profiles keep `<style>` and
 * every presentation attribute a diagram uses.
 *
 * The one real casualty is `<foreignObject>`. DOMPurify 3.x drops HTML nested
 * inside it whatever the profile, so mermaid's default HTML labels would be
 * sanitised away and flowchart nodes would render empty. The fix is to stop
 * mermaid emitting them: `htmlLabels: false` makes it lay labels out with plain
 * SVG `<text>`, which the sanitiser passes through untouched. That is also the
 * safer configuration outright, since it means no HTML subtree ever exists in
 * the diagram for a payload to hide in. The visible cost is that labels no
 * longer support inline HTML markup, which mermaid already refuses to honour
 * under `securityLevel: 'strict'`.
 */

import { useEffect, useId, useRef, useState } from 'react';
import DOMPurify, { type Config as DOMPurifyConfig } from 'isomorphic-dompurify';

interface MermaidBlockProps {
  code: string;
}

/**
 * Sanitiser configuration for mermaid's SVG output.
 *
 * Profiles keep the markup a diagram legitimately needs. The FORBID lists are
 * belt-and-braces on top of DOMPurify's own defaults: DOMPurify already drops
 * `<script>`, every `on*` handler and `javascript:` URIs, but naming the
 * script-bearing containers explicitly means a profile change cannot quietly
 * re-admit them.
 */
const SANITIZE_CONFIG: DOMPurifyConfig = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: [
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'base',
    'link',
    'meta',
    'set',
    'animate',
  ],
  FORBID_ATTR: ['formaction', 'action', 'ping', 'srcdoc'],
};

export function MermaidBlock({ code }: MermaidBlockProps) {
  const id = useId();
  // Replace non-word chars so the id is a valid HTML id attribute.
  const safeId = 'mermaid-' + id.replace(/[^a-zA-Z0-9-]/g, '');

  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaidModule = await import('mermaid');
        const mermaid = mermaidModule.default;

        mermaid.initialize({
          startOnLoad: false,
          // Pinned, not inherited. See the SECURITY note at the top of the
          // file: 'strict' HTML-encodes tags appearing in diagram text and
          // disables the `click` directive, which is what stops a crafted
          // diagram from binding a handler or a javascript: href.
          securityLevel: 'strict',
          // Lay labels out as SVG <text> rather than HTML in a
          // <foreignObject>. Required for the sanitiser below to be lossless,
          // and it removes the only HTML subtree a diagram could carry.
          flowchart: { htmlLabels: false },
          class: { htmlLabels: false },
        });

        const { svg } = await mermaid.render(safeId, code);

        if (!cancelled && containerRef.current) {
          // mermaid.render returns an SVG string built from untrusted diagram
          // source. Sanitise before it reaches the DOM, so that what mermaid
          // intended to emit and what actually renders cannot diverge.
          containerRef.current.innerHTML = DOMPurify.sanitize(svg, SANITIZE_CONFIG);
        }
      } catch {
        if (!cancelled) {
          setError(true);
        }
      }
    }

    render();

    return () => {
      cancelled = true;
    };
  }, [code, safeId]);

  if (error) {
    return (
      <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 text-sm text-foreground">
        <code>{code}</code>
      </pre>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-2 overflow-x-auto rounded-md border border-border bg-muted p-3"
      aria-label="Mermaid diagram"
    />
  );
}
