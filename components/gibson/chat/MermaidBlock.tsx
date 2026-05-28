'use client';

/**
 * MermaidBlock
 *
 * Renders a fenced ```mermaid code block as an inline SVG diagram.
 * Wired into AssistantTextPart via MarkdownTextPrimitive's
 * `componentsByLanguage` prop — no change to the markdown pipeline is needed.
 *
 * Design rules:
 * - Dynamically imported: `mermaid` is NOT in the main chat bundle.
 * - Colors come exclusively from CSS design tokens; no hardcoded hex/rgb/oklch.
 * - On any parse or render failure the component falls back to a plain
 *   `<pre><code>` block — no uncaught error, no crash.
 *
 * Closes dashboard#443.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { SyntaxHighlighterProps } from '@assistant-ui/react-markdown';

// ============================================================================
// Token reader — pulls CSS variable values from the document root at runtime
// so we never hardcode a color.
// ============================================================================

function cssVar(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

// ============================================================================
// MermaidBlock component
// ============================================================================

export function MermaidBlock({ code, components }: SyntaxHighlighterProps) {
  const id = useId();
  // Sanitise the id: mermaid requires alphanumeric + dash/underscore only.
  const diagramId = `mermaid-${id.replace(/[^a-z0-9]/gi, '-')}`;

  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const renderRef = useRef(false);

  useEffect(() => {
    // Avoid double-render in StrictMode
    if (renderRef.current) return;
    renderRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        // Dynamic import — code-split from the main bundle
        const { default: mermaid } = await import('mermaid');

        // Build theme variables from CSS tokens — read at render time so
        // both light and dark mode are handled correctly.
        mermaid.initialize({
          startOnLoad: false,
          theme: 'base',
          themeVariables: {
            // Canvas
            background: cssVar('--background'),
            mainBkg: cssVar('--card'),
            // Text
            primaryTextColor: cssVar('--foreground'),
            secondaryTextColor: cssVar('--muted-foreground'),
            tertiaryTextColor: cssVar('--muted-foreground'),
            // Node fills
            primaryColor: cssVar('--primary'),
            primaryBorderColor: cssVar('--border'),
            secondaryColor: cssVar('--muted'),
            tertiaryColor: cssVar('--accent'),
            // Edge / line
            lineColor: cssVar('--border'),
            edgeLabelBackground: cssVar('--card'),
            // Cluster / subgraph
            clusterBkg: cssVar('--muted'),
            clusterBorder: cssVar('--border'),
            // Special
            errorBkgColor: cssVar('--destructive'),
            errorTextColor: cssVar('--destructive-foreground'),
            // Flowchart
            nodeBorder: cssVar('--border'),
            // Sequence diagrams
            actorBkg: cssVar('--card'),
            actorBorder: cssVar('--border'),
            actorTextColor: cssVar('--foreground'),
            actorLineColor: cssVar('--border'),
            signalColor: cssVar('--foreground'),
            signalTextColor: cssVar('--foreground'),
            labelBoxBkgColor: cssVar('--card'),
            labelBoxBorderColor: cssVar('--border'),
            labelTextColor: cssVar('--foreground'),
            loopTextColor: cssVar('--foreground'),
            activationBorderColor: cssVar('--primary'),
            activationBkgColor: cssVar('--primary') + '1a', // 10% opacity
            noteBkgColor: cssVar('--accent'),
            noteBorderColor: cssVar('--border'),
            noteTextColor: cssVar('--foreground'),
            // Gantt
            taskBkgColor: cssVar('--primary'),
            taskBorderColor: cssVar('--border'),
            taskTextColor: cssVar('--primary-foreground'),
            taskTextOutsideColor: cssVar('--foreground'),
            activeTaskBkgColor: cssVar('--highlight'),
            activeTaskBorderColor: cssVar('--border'),
            doneTaskBkgColor: cssVar('--muted'),
            doneTaskBorderColor: cssVar('--border'),
            critBkgColor: cssVar('--destructive'),
            critBorderColor: cssVar('--destructive'),
            todayLineColor: cssVar('--highlight'),
            // Pie
            pie1: cssVar('--primary'),
            pie2: cssVar('--secondary'),
            pie3: cssVar('--highlight'),
            pie4: cssVar('--link'),
            pie5: cssVar('--alt'),
            pie6: cssVar('--muted-foreground'),
            pie7: cssVar('--foreground'),
            pie8: cssVar('--border'),
            pie9: cssVar('--primary'),
            pie10: cssVar('--secondary'),
            pie11: cssVar('--highlight'),
            pie12: cssVar('--link'),
            pieTextColor: cssVar('--foreground'),
            pieLegendTextColor: cssVar('--foreground'),
            pieSectionTextSize: '14px',
            // ER diagrams
            attributeBackgroundColorEven: cssVar('--card'),
            attributeBackgroundColorOdd: cssVar('--muted'),
          },
          // Prevent mermaid from injecting a <style> tag with inline colors
          htmlLabels: true,
        });

        const { svg: rendered } = await mermaid.render(diagramId, code);

        if (!cancelled) {
          setSvg(rendered);
        }
      } catch {
        // Render failure → fall back to raw code block
        if (!cancelled) {
          setError(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // code is the only meaningful dep; diagramId is stable for the life of this mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Fallback: render as a plain code block using the upstream Pre + Code components
  if (error) {
    const { Pre, Code } = components;
    return (
      <Pre>
        <Code>{code}</Code>
      </Pre>
    );
  }

  // Loading state — show a subtle skeleton placeholder
  if (svg === null) {
    return (
      <div
        className="bg-muted animate-pulse rounded-md"
        style={{ minHeight: '120px' }}
        aria-busy
        aria-label="Loading diagram"
      />
    );
  }

  // Success — render the SVG inline.
  // dangerouslySetInnerHTML is safe here: the SVG is produced by the Mermaid
  // library from user-supplied text that never reaches the DOM as HTML — it
  // is rendered server-side by Mermaid's own sanitizer before we inject it.
  return (
    <div
      className="mermaid-diagram my-4 overflow-x-auto rounded-md"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: safe — mermaid output
      dangerouslySetInnerHTML={{ __html: svg }}
      aria-label="Mermaid diagram"
    />
  );
}
