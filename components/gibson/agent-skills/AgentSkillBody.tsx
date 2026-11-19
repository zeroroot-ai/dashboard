// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * AgentSkillBody. The body of SKILL.md comes from the publisher, so it is
 * untrusted text. The default view is plain text in a <pre> element. The
 * formatted view uses react-markdown, which does not parse raw HTML. The
 * formatted view also drops images, so a body cannot make the browser load a
 * remote file.
 */

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Button } from "@/components/ui/button";
import { AGENT_SKILL_TEXT as T } from "./texts";

export function AgentSkillBody({ body }: { body: string }) {
  const [formatted, setFormatted] = React.useState(false);

  if (body.trim() === "") {
    return <p className="text-muted-foreground text-sm">{T.bodyEmpty}</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2" role="group" aria-label={T.bodyTitle}>
        <Button
          size="sm"
          variant={formatted ? "outline" : "secondary"}
          aria-pressed={!formatted}
          onClick={() => setFormatted(false)}
        >
          {T.bodyPlain}
        </Button>
        <Button
          size="sm"
          variant={formatted ? "secondary" : "outline"}
          aria-pressed={formatted}
          onClick={() => setFormatted(true)}
        >
          {T.bodyRendered}
        </Button>
      </div>
      {formatted ? (
        <article data-testid="agent-skill-body-formatted" className="prose prose-sm max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            disallowedElements={["img"]}
            unwrapDisallowed
          >
            {body}
          </ReactMarkdown>
        </article>
      ) : (
        <pre
          data-testid="agent-skill-body-plain"
          className="bg-muted overflow-x-auto rounded p-3 text-xs whitespace-pre-wrap"
        >
          {body}
        </pre>
      )}
    </div>
  );
}
