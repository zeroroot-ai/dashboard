// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * EvidenceList. Every evidence item of a finding, in the stored order. An item
 * shows its type, its tier ("Recorded by Gibson" or "Typed by the agent"), the
 * id of the tool call for a recorded item, and its whole content.
 *
 * The content is data of the target and is untrusted. It shows as plain text
 * in a monospace block, through React text nodes. It is never HTML and never
 * Markdown. A long item starts collapsed behind an expand control, and the
 * expand control shows the whole text.
 */

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EvidenceDTO } from "@/src/lib/gibson-client/finding-types";
import {
  collapsedEvidence,
  evidenceKindLabel,
  evidenceTierLabel,
  isLongEvidence,
} from "@/src/lib/findings/evidence";

function EvidenceItem({ item, index }: { item: EvidenceDTO; index: number }) {
  const long = isLongEvidence(item.content);
  const [expanded, setExpanded] = React.useState(false);
  const shown = long && !expanded ? collapsedEvidence(item.content) : item.content;
  const isConversation = item.kind === "conversation";

  return (
    <li className="border-border space-y-2 rounded-md border p-3" data-testid="evidence-item">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground text-xs tabular-nums">{index + 1}.</span>
        <Badge variant="outline" data-testid="evidence-kind">
          {evidenceKindLabel(item.kind)}
        </Badge>
        <Badge variant={item.tier === "recorded" ? "success" : "secondary"} data-testid="evidence-tier">
          {evidenceTierLabel(item.tier)}
        </Badge>
        {item.tier === "recorded" && item.toolCallId ? (
          <span className="text-muted-foreground font-mono text-xs" data-testid="evidence-tool-call">
            Tool call {item.toolCallId}
          </span>
        ) : null}
      </div>
      {item.title ? <p className="text-sm font-medium">{item.title}</p> : null}
      <pre
        data-testid="evidence-content"
        data-form={isConversation ? "dialogue" : "text"}
        aria-label={isConversation ? "Conversation" : undefined}
        className="bg-muted overflow-x-auto rounded p-3 font-mono text-xs break-words whitespace-pre-wrap"
      >
        {shown}
        {long && !expanded ? "\n..." : ""}
      </pre>
      {long ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show all"}
        </Button>
      ) : null}
    </li>
  );
}

export function EvidenceList({ evidence }: { evidence: EvidenceDTO[] }) {
  if (evidence.length === 0) {
    return (
      <p data-testid="evidence-empty" className="text-muted-foreground text-sm">
        This finding holds no evidence.
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {evidence.map((item, i) => (
        <EvidenceItem key={i} item={item} index={i} />
      ))}
    </ol>
  );
}
