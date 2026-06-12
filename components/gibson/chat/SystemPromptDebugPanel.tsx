'use client';

import { useChatStore } from '@/src/stores/chat-store';

// ============================================================================
// Layer definitions
// ============================================================================

interface PromptLayer {
  label: string;
  /** Leading text that identifies this section in the prompt string. */
  startsWith: string;
}

const PROMPT_LAYERS: PromptLayer[] = [
  { label: 'Identity', startsWith: 'You are an AI assistant' },
  { label: 'Persona', startsWith: 'You are the ' },
  { label: 'Graph Summary', startsWith: 'Here is an overview of the operator’s knowledge graph' },
  { label: 'Langfuse Traces', startsWith: 'Recent agent execution traces' },
  { label: 'User Activity', startsWith: "The operator's recent platform activity" },
  { label: 'Platform Inventory', startsWith: 'Platform inventory' },
  { label: 'Focused Node', startsWith: 'The operator currently has the following node' },
];

// ============================================================================
// Helpers
// ============================================================================

/**
 * Split the flat prompt string into labelled sections using the layer markers.
 * Sections are separated by `\n\n` in the prompt.
 */
function parseLayers(prompt: string): Array<{ label: string; content: string | null }> {
  const sections = prompt.split(/\n\n+/);

  return PROMPT_LAYERS.map((layer) => {
    const match = sections.find((s) => s.startsWith(layer.startsWith));
    return { label: layer.label, content: match ?? null };
  });
}

// ============================================================================
// Component
// ============================================================================

export function SystemPromptDebugPanel() {
  const systemPromptDebug = useChatStore((s) => s.systemPromptDebug);

  if (!systemPromptDebug) {
    return (
      <div className="border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        No system prompt captured yet. Send a message with the debug panel open to populate this view.
      </div>
    );
  }

  const layers = parseLayers(systemPromptDebug);

  return (
    <div className="border-b bg-muted/40 px-4 py-2">
      <p className="mb-2 text-xs font-semibold text-foreground">System Prompt Layers</p>
      <div className="flex flex-col gap-1">
        {layers.map(({ label, content }) =>
          content ? (
            <details key={label} className="group">
              <summary className="cursor-pointer select-none list-none text-xs font-medium text-foreground hover:text-highlight focus-visible:outline-none">
                <span className="mr-1 inline-block transition-transform group-open:rotate-90">&#9656;</span>
                {label}
              </summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded border border-border bg-card px-3 py-2 text-xs text-foreground">
                {content}
              </pre>
            </details>
          ) : (
            <div key={label} className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="mr-1">&#9656;</span>
              {label}
              <span className="italic">- not available</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
