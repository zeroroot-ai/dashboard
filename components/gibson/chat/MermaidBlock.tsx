'use client';

/**
 * MermaidBlock — renders a Mermaid diagram inside an assistant message.
 *
 * Design constraints:
 * - Mermaid is dynamically imported so it never lands in the initial bundle.
 * - On parse/render error, falls back to a <pre><code> block showing raw source.
 * - All styling uses semantic design tokens only (no hardcoded colours).
 */

import { useEffect, useId, useRef, useState } from 'react';

interface MermaidBlockProps {
  code: string;
}

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

        mermaid.initialize({ startOnLoad: false });

        const { svg } = await mermaid.render(safeId, code);

        if (!cancelled && containerRef.current) {
          // mermaid.render returns an SVG string. We set it directly; DOMPurify
          // is intentionally not applied here because SVG diagrams contain
          // inline styles and scripts that DOMPurify strips, breaking the
          // rendering. Mermaid's own output is trusted — it doesn't eval
          // user-controlled HTML, only diagram syntax.
          containerRef.current.innerHTML = svg;
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
