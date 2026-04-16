'use client';

import { MessageSquare } from 'lucide-react';
import { Suggestion } from '@/components/ui/custom/prompt/suggestion';
import type { ChatAgent } from '@/src/stores/chat-store';
import type { GraphSummaryResponse } from '@/src/lib/graph/summary';

// ============================================================================
// Types
// ============================================================================

export interface WelcomeStateProps {
  agent: ChatAgent | undefined;
  graphSummary: GraphSummaryResponse | null;
  onSendPrompt: (text: string) => void;
}

// ============================================================================
// Suggested prompts
// ============================================================================

const SUGGESTED_PROMPTS = [
  'Summarize my latest mission findings',
  'What hosts have critical vulnerabilities?',
  'Show me the attack surface overview',
  'What did the last scan discover?',
];

// ============================================================================
// Component
// ============================================================================

export function WelcomeState({ agent, graphSummary, onSendPrompt }: WelcomeStateProps) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-lg text-center">
        <div className="bg-primary/10 mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full">
          <MessageSquare className="text-primary h-8 w-8" />
        </div>
        <h2 className="mb-2 text-xl font-semibold">
          Chat with {agent?.name || 'Gibson'}
        </h2>
        <p className="text-muted-foreground mb-1 text-sm">
          {agent?.description || 'AI-powered security assistant'}
        </p>
        {graphSummary && graphSummary.stats.hosts > 0 && (
          <p className="text-muted-foreground mb-4 text-xs">
            Your knowledge graph has {graphSummary.stats.hosts} hosts,{' '}
            {graphSummary.stats.findings} findings, and{' '}
            {graphSummary.stats.missions} missions.
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <Suggestion key={prompt} onClick={() => onSendPrompt(prompt)}>
              {prompt}
            </Suggestion>
          ))}
        </div>
      </div>
    </div>
  );
}
