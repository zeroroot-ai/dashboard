"use client";

import * as React from "react";
import { ChevronRightIcon, WrenchIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Markdown } from "@/components/ui/custom/prompt/markdown";
import { formatTokenCount } from "@/src/lib/trace-utils";
import type { ConversationMessage, ToolCallBlock } from "@/src/types/trace";

/**
 * ConversationView renders a single LLM call's prompt ↔ response exchange as a
 * readable chat thread. It is the core "readable manner" deliverable of the
 * Gibson Traces viewer (dashboard#464) and is shared between the mission
 * Traces tab and the standalone trace detail page (dashboard#470), there is
 * one conversation renderer, not two.
 *
 * Rendering rules:
 * - `system`        → collapsed-by-default block (system prompts are long and
 *                     templated; the meaningful turns are user ↔ assistant).
 * - `user`          → right-aligned bubble, plain pre-wrapped text.
 * - `assistant`     → left-aligned bubble, markdown-rendered, with any tool
 *                     calls it requested shown inline beneath it.
 * - `tool`          → collapsible "Tool result" block with the call id and the
 *                     payload pretty-printed as JSON.
 *
 * `tokens`, when supplied, renders the generation's input/output token usage
 * as a chip after the thread. Per-message token attribution is not available
 * from the upstream observability store (tokens are recorded per generation,
 * not per message), so the chip reflects the whole exchange.
 */

const ROLE_LABEL: Record<ConversationMessage["role"], string> = {
  system: "System",
  user: "User",
  assistant: "Assistant",
  tool: "Tool result",
};

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function ToolCallView({ call }: { call: ToolCallBlock }) {
  return (
    <div className="mt-2 rounded-md border border-border bg-muted/40 p-2">
      <div className="flex items-center gap-1.5 text-xs font-mono text-highlight">
        <WrenchIcon className="size-3" aria-hidden="true" />
        {call.name || "tool"}
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
        {prettyJson(call.arguments)}
      </pre>
    </div>
  );
}

function CollapsibleBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible className="rounded-md border border-border bg-muted/30">
      <CollapsibleTrigger className="group flex w-full items-center gap-1.5 px-3 py-2 text-left text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        <ChevronRightIcon
          className="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-90"
          aria-hidden="true"
        />
        {label}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="whitespace-pre-wrap break-words px-3 pb-3 font-mono text-xs text-muted-foreground">
          {children}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ChatBubble({ message }: { message: ConversationMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div className="max-w-[85%] rounded-lg border border-border bg-card px-3 py-2">
        <div className="mb-1 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
          {ROLE_LABEL[message.role]}
          {message.name ? ` · ${message.name}` : ""}
        </div>
        {message.content ? (
          isUser ? (
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content}
            </p>
          ) : (
            <Markdown className="text-sm break-words">{message.content}</Markdown>
          )
        ) : null}
        {message.toolCalls?.map((call) => (
          <ToolCallView key={call.id || call.name} call={call} />
        ))}
      </div>
    </div>
  );
}

export interface ConversationViewProps {
  messages: ConversationMessage[];
  /** Generation-level token usage; renders a chip after the thread when set. */
  tokens?: { input: number; output: number };
}

export function ConversationView({ messages, tokens }: ConversationViewProps) {
  if (!messages || messages.length === 0) {
    return (
      <p className="font-mono text-xs text-muted-foreground">
        No conversation content recorded for this call.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {messages.map((message, index) => {
        const key = `${message.role}-${index}`;
        if (message.role === "system") {
          return (
            <CollapsibleBlock key={key} label="System prompt">
              {message.content}
            </CollapsibleBlock>
          );
        }
        if (message.role === "tool") {
          return (
            <CollapsibleBlock
              key={key}
              label={`Tool result${message.toolCallId ? ` · ${message.toolCallId}` : ""}`}
            >
              {prettyJson(message.content)}
            </CollapsibleBlock>
          );
        }
        return <ChatBubble key={key} message={message} />;
      })}

      {tokens && (tokens.input > 0 || tokens.output > 0) && (
        <div className="flex justify-end">
          <Badge
            data-testid="conversation-tokens"
            variant="outline"
            className="font-mono text-[10px] tabular-nums border-border text-muted-foreground"
          >
            <span className="text-highlight">{formatTokenCount(tokens.input)}</span>
            &nbsp;in ·{" "}
            <span className="text-highlight">{formatTokenCount(tokens.output)}</span>
            &nbsp;out
          </Badge>
        </div>
      )}
    </div>
  );
}
