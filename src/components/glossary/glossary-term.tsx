/**
 * <GlossaryTerm term="..." /> — wraps its children in a Shadcn
 * Tooltip whose content is the proto-derived definition for the
 * named term. If the term isn't in the glossary, falls back to
 * rendering children plain (silent graceful fallback per
 * design.md Component 5).
 *
 * Usage:
 *
 *   <GlossaryTerm term="NODE_TYPE_AGENT">Agent</GlossaryTerm>
 *
 * The term key is the canonical proto enum value name (or
 * message/verb name) — same shape glossary.json uses.
 *
 * Spec: mission-dashboard-rewrite Requirement 5 AC 2.
 */

"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { useGlossary } from "./glossary-provider";

import type { ReactNode } from "react";

interface GlossaryTermProps {
  term: string;
  children: ReactNode;
  /**
   * underlineOnHover — when true, shows a dotted underline on the
   * inline term so users discover the tooltip affordance. Defaults
   * to true.
   */
  underlineOnHover?: boolean;
}

export function GlossaryTerm({
  term,
  children,
  underlineOnHover = true,
}: GlossaryTermProps) {
  const map = useGlossary();
  const definition = map[term];

  if (!definition) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={
              underlineOnHover
                ? "decoration-dotted decoration-muted-foreground/50 underline-offset-4 hover:underline cursor-help"
                : "cursor-help"
            }
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-md text-sm leading-snug">
          <p className="text-xs font-mono mb-1 text-muted-foreground">{term}</p>
          <p>{definition}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
