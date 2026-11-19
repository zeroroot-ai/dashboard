// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { formatModelCallCost } from "@/src/lib/world-traces";
import type { LlmCallDetailData, ModelCallItem } from "@/src/types/trace";

/**
 * ModelCallDetail shows the full record of one model call. It is the one view
 * of a model call. The Gibson Traces run view and the per-tick inspector both
 * use it.
 *
 * It shows the provider, the model, the HTTP status, the tokens with the cache
 * counts, the cost and the error text. Then it shows the request items, and
 * then the output items, each one by its item type.
 *
 * The text of an item is untrusted. This component shows each string as a React
 * text node. It never renders Markdown or HTML from an item.
 */

const ROLE_LABEL: Record<string, string> = {
  system: "System",
  developer: "Developer",
  user: "User",
  assistant: "Assistant",
  tool: "Tool",
};

function itemLabel(item: ModelCallItem): string {
  switch (item.kind) {
    case "message":
      return ROLE_LABEL[item.role] ?? (item.role || "Message");
    case "reasoning":
      return "Reasoning";
    case "function_call":
      return item.name ? `Function call: ${item.name}` : "Function call";
    case "function_call_output":
      return "Function call output";
    case "text":
      return "Text";
    case "unknown":
      return "Unknown item (raw JSON)";
  }
}

function itemBody(item: ModelCallItem): string {
  switch (item.kind) {
    case "message":
    case "reasoning":
    case "text":
      return item.text;
    case "function_call":
      return item.arguments;
    case "function_call_output":
      return item.output;
    case "unknown":
      return item.json;
  }
}

function itemCallId(item: ModelCallItem): string {
  return item.kind === "function_call" || item.kind === "function_call_output"
    ? item.callId
    : "";
}

function ItemBlock({ item }: { item: ModelCallItem }) {
  const body = itemBody(item);
  const callId = itemCallId(item);
  return (
    <li
      data-testid={`model-call-item-${item.kind}`}
      className="rounded-md border border-border bg-muted/30 px-3 py-2"
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        <span>{itemLabel(item)}</span>
        {callId ? <span className="normal-case">{callId}</span> : null}
      </div>
      {body ? (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
          {body}
        </pre>
      ) : (
        <p className="text-xs italic text-muted-foreground">No text.</p>
      )}
    </li>
  );
}

function ItemList({
  title,
  items,
  testId,
}: {
  title: string;
  items: ModelCallItem[];
  testId: string;
}) {
  if (items.length === 0) return null;
  return (
    <section data-testid={testId} className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold">{title}</h4>
      <ol className="flex flex-col gap-2">
        {items.map((item, index) => (
          <ItemBlock key={index} item={item} />
        ))}
      </ol>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="font-mono text-xs tabular-nums">{children}</dd>
    </div>
  );
}

function statusVariant(call: LlmCallDetailData): "destructive" | "success" | "outline" {
  if (call.failed) return "destructive";
  return call.httpStatus === 0 ? "outline" : "success";
}

export function ModelCallDetail({ call }: { call: LlmCallDetailData }) {
  const hasItems = call.requestItems.length > 0 || call.outputItems.length > 0;
  return (
    <div data-testid="model-call-detail" className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Provider">{call.provider || "Unknown"}</Field>
        <Field label="Model">{call.model || "Unknown"}</Field>
        <Field label="HTTP status">
          <Badge variant={statusVariant(call)} data-testid="model-call-status">
            {call.httpStatus === 0 ? "Unknown" : call.httpStatus}
          </Badge>
        </Field>
        <Field label="Cost">
          <span data-testid="model-call-cost">{formatModelCallCost(call.cost)}</span>
        </Field>
        <Field label="Input tokens">{call.promptTokens}</Field>
        <Field label="Output tokens">{call.completionTokens}</Field>
        <Field label="Cache read tokens">
          <span data-testid="model-call-cache-read">{call.cacheReadTokens}</span>
        </Field>
        <Field label="Cache write tokens">
          <span data-testid="model-call-cache-write">{call.cacheWriteTokens}</span>
        </Field>
      </dl>

      {call.errorText ? (
        <section className="flex flex-col gap-1">
          <h4 className="text-xs font-semibold">Error text</h4>
          <pre
            data-testid="model-call-error"
            className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border border-destructive/40 px-3 py-2 font-mono text-xs text-destructive"
          >
            {call.errorText}
          </pre>
        </section>
      ) : null}

      <ItemList
        title="Request items"
        items={call.requestItems}
        testId="model-call-request-items"
      />
      <ItemList
        title="Output items"
        items={call.outputItems}
        testId="model-call-output-items"
      />

      {!hasItems ? (
        <p className="text-xs italic text-muted-foreground">
          This model call has no record text.
        </p>
      ) : null}
    </div>
  );
}
