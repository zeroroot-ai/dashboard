"use client";

/**
 * EmbeddingGatePrompt (E11 BYO-embedder, gibson#810).
 *
 * Vector features (vector recall, GraphRAG, belief-RAG, finding
 * classification) require a configured embedding provider. When none is
 * configured the daemon returns a graceful "configure an embedding provider"
 * gate error rather than producing results. This component renders that gate
 * as a clear, actionable prompt with a direct path to the provider config page
 * — mirroring how an empty list surfaces a "configure a provider" call to
 * action.
 *
 * Pure presentation: the caller decides when the gate is active (typically by
 * passing a daemon error through `isEmbeddingGateError`) and renders this in
 * place of the gated content.
 */

import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/gibson/shared/EmptyState";

/** Canonical URL of the provider configuration page. */
export const PROVIDERS_SETTINGS_HREF = "/dashboard/pages/settings/providers";

export interface EmbeddingGatePromptProps {
  /**
   * Name of the feature being gated, woven into the description so the prompt
   * reads naturally (e.g. "Vector recall", "GraphRAG", "the knowledge graph").
   */
  feature?: string;
  /** Optional className passed through to the underlying card. */
  className?: string;
}

export function EmbeddingGatePrompt({
  feature = "This feature",
  className,
}: EmbeddingGatePromptProps) {
  return (
    <EmptyState
      icon={Sparkles}
      title="Configure an embedding provider"
      className={className}
      description={
        <>
          {feature} needs an embedding provider. Add a provider with the{" "}
          <span className="font-medium text-foreground">Embeddings</span>{" "}
          capability and a default embedding model to enable vector recall,
          GraphRAG, belief-RAG and finding classification.
        </>
      }
      primaryCta={
        <Button asChild size="sm" data-testid="embedding-gate-configure">
          <Link href={PROVIDERS_SETTINGS_HREF}>Configure providers</Link>
        </Button>
      }
    />
  );
}
