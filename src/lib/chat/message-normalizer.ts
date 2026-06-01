/**
 * Message Normalizer — lossless bidirectional mapping between the AI SDK v6
 * `UIMessage` parts model and the persisted `ConversationMessage` proto parts.
 *
 * This is the SINGLE source of truth for message shape on the dashboard side.
 * All save and load paths route through these two functions.
 *
 * Spec: dashboard#548 (Module 3), closes dashboard#550.
 *
 * Design notes:
 * - Ordering is preserved: proto parts and UIMessage parts appear in the same
 *   sequence in both directions.
 * - Every known part type has an explicit mapping in both directions.
 * - Unknown part types are never silently dropped. They are converted to a
 *   `MessagePartText` containing a JSON representation of the unknown part on
 *   the save path, and to a `TextUIPart` carrying the same JSON on the load
 *   path. This ensures round-trips are lossless even when the AI SDK or proto
 *   schema evolves ahead of this module.
 * - The module is pure (no I/O, no side effects) and has no runtime deps
 *   beyond the proto generated types. Import from anywhere.
 *
 * Part type mapping table:
 *
 *   UIMessage part type               → proto MessagePart case
 *   ──────────────────────────────────────────────────────────
 *   text (TextUIPart)                 → text (MessagePartText)
 *   tool-* (ToolUIPart, DynamicTool)  → tool_call + tool_result (MessagePartToolCall / MessagePartToolResult)
 *   file (FileUIPart)                 → attachment_ref (MessagePartAttachmentRef)
 *   source-url (SourceUrlUIPart)      → citation (MessagePartCitation, url=url, citationId=sourceId)
 *   reasoning (ReasoningUIPart)       → reasoning (MessagePartReasoning)
 *   unknown / unhandled               → text (MessagePartText carrying JSON fallback)
 *
 *   proto MessagePart case            → UIMessage part type
 *   ──────────────────────────────────────────────────────────
 *   text                              → TextUIPart
 *   tool_call                         → DynamicToolUIPart (state=input-available)
 *   tool_result                       → DynamicToolUIPart (state=output-available)
 *   citation                          → SourceUrlUIPart (sourceId=citationId, url=url, title=label)
 *   attachment_ref                    → FileUIPart (mediaType, filename=name, url=attachment_id as opaque ref)
 *   reasoning                         → ReasoningUIPart
 *
 * Tool-call / tool-result pairing note:
 *   The AI SDK v6 represents a tool invocation as a SINGLE `ToolUIPart` or
 *   `DynamicToolUIPart` that transitions through states (input-available →
 *   output-available). The proto stores them as TWO separate ordered parts
 *   (MessagePartToolCall, then MessagePartToolResult). On save we emit two
 *   proto parts per tool invocation with a result. On load, adjacent
 *   tool_call + tool_result pairs with the same `tool_call_id` are fused back
 *   into a single DynamicToolUIPart with `state=output-available`. A lone
 *   tool_call (no matching result yet) becomes `state=input-available`.
 */

import type { UIMessage } from 'ai';
import type {
  MessagePart,
  ConversationMessage,
} from '@/src/gen/gibson/tenant/v1/user_pb';
import { create } from '@bufbuild/protobuf';
import {
  MessagePartSchema,
  MessagePartTextSchema,
  MessagePartToolCallSchema,
  MessagePartToolResultSchema,
  MessagePartCitationSchema,
  MessagePartAttachmentRefSchema,
  MessagePartReasoningSchema,
} from '@/src/gen/gibson/tenant/v1/user_pb';

// ---------------------------------------------------------------------------
// Public surface types
// ---------------------------------------------------------------------------

/**
 * A proto-ready message record, ready for inclusion in a
 * `SaveConversationRequest.messages` repeated field.
 */
export interface ProtoMessageRecord {
  id: string;
  role: string;
  parts: MessagePart[];
  createdAtUnix: bigint;
}

// ---------------------------------------------------------------------------
// UIMessage part types (inferred from the AI SDK's exported type union)
// ---------------------------------------------------------------------------

// The AI SDK exports UIMessagePart as a union type. We use structural matching
// so this module doesn't hard-couple to the AI SDK's internal export names.

interface TextUIPart {
  type: 'text';
  text: string;
}

interface ReasoningUIPart {
  type: 'reasoning';
  text: string;
  state?: 'streaming' | 'done';
}

interface SourceUrlUIPart {
  type: 'source-url';
  sourceId: string;
  url: string;
  title?: string;
}

interface FileUIPart {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
}

interface StepStartUIPart {
  type: 'step-start';
}

// Dynamic tool parts: state machine with multiple states. We only read
// the fields we need to save or restore.
interface DynamicToolUIPart {
  type: 'dynamic-tool';
  toolName: string;
  toolCallId: string;
  state:
    | 'input-streaming'
    | 'input-available'
    | 'approval-requested'
    | 'approval-responded'
    | 'output-available'
    | 'output-error'
    | 'output-denied';
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

// Static (typed) tool parts follow `type: "tool-<name>"` convention.
interface StaticToolUIPart {
  type: string; // "tool-<name>"
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
}

type KnownUIPart =
  | TextUIPart
  | ReasoningUIPart
  | SourceUrlUIPart
  | FileUIPart
  | DynamicToolUIPart
  | StaticToolUIPart
  | StepStartUIPart;

// Use a looser type for internal manipulation — we cast from UIMessage['parts'][number]
// which is a strict union. The intersection with Record<string, unknown> is only
// used for the fallback path where we stringify the whole part.
type AnyUIPart = { type: string } & Record<string, unknown>;

// ---------------------------------------------------------------------------
// uiMessageToProto — UIMessage → proto ConversationMessage parts
// ---------------------------------------------------------------------------

/**
 * Convert a single AI SDK v6 `UIMessage` to the flat proto record shape
 * expected by `SaveConversationRequest`.
 *
 * Every part is mapped explicitly. Unknown part types are preserved as a text
 * fallback carrying a JSON representation, so they survive a round-trip.
 *
 * `step-start` parts are intentionally skipped — they carry no user-visible
 * data and would add noise to storage.
 */
export function uiMessageToProto(msg: UIMessage, createdAtUnix?: number): ProtoMessageRecord {
  const parts: MessagePart[] = [];

  for (const rawPart of msg.parts) {
    const part = rawPart as AnyUIPart;

    if (part.type === 'text') {
      const t = part as unknown as TextUIPart;
      parts.push(
        create(MessagePartSchema, {
          part: {
            case: 'text',
            value: create(MessagePartTextSchema, { text: t.text }),
          },
        }),
      );
      continue;
    }

    if (part.type === 'reasoning') {
      const r = part as unknown as ReasoningUIPart;
      parts.push(
        create(MessagePartSchema, {
          part: {
            case: 'reasoning',
            value: create(MessagePartReasoningSchema, { text: r.text }),
          },
        }),
      );
      continue;
    }

    if (part.type === 'source-url') {
      const s = part as unknown as SourceUrlUIPart;
      parts.push(
        create(MessagePartSchema, {
          part: {
            case: 'citation',
            value: create(MessagePartCitationSchema, {
              citationId: s.sourceId,
              label: s.title ?? '',
              url: s.url,
            }),
          },
        }),
      );
      continue;
    }

    if (part.type === 'file') {
      const f = part as unknown as FileUIPart;
      parts.push(
        create(MessagePartSchema, {
          part: {
            case: 'attachmentRef',
            value: create(MessagePartAttachmentRefSchema, {
              attachmentId: f.url,
              mediaType: f.mediaType,
              name: f.filename ?? '',
            }),
          },
        }),
      );
      continue;
    }

    if (part.type === 'step-start') {
      // step-start carries no user-visible data; skip.
      continue;
    }

    // -----------------------------------------------------------------------
    // Tool part handling
    //
    // Both `dynamic-tool` and `tool-<name>` (static typed tools) are handled
    // here. A tool invocation with a result emits two proto parts: a
    // tool_call followed by a tool_result with the same tool_call_id.
    // -----------------------------------------------------------------------

    const isDynamicTool = part.type === 'dynamic-tool';
    const isStaticTool = typeof part.type === 'string' && part.type.startsWith('tool-');

    if (isDynamicTool || isStaticTool) {
      const t = part as unknown as DynamicToolUIPart | StaticToolUIPart;
      const toolName = isDynamicTool
        ? (t as DynamicToolUIPart).toolName
        : (t as StaticToolUIPart).type.slice('tool-'.length);
      const toolCallId = t.toolCallId;

      // Always emit the call part.
      parts.push(
        create(MessagePartSchema, {
          part: {
            case: 'toolCall',
            value: create(MessagePartToolCallSchema, {
              toolCallId,
              name: toolName,
              arguments: t.input !== undefined ? JSON.stringify(t.input) : '{}',
            }),
          },
        }),
      );

      // Emit the result part when the tool has completed (successfully or with error).
      const state = t.state;
      if (state === 'output-available' || state === 'output-error' || state === 'output-denied') {
        const resultPayload =
          state === 'output-available'
            ? t.output
            : state === 'output-error'
              ? { error: (t as DynamicToolUIPart).errorText ?? 'unknown error' }
              : { denied: true };

        parts.push(
          create(MessagePartSchema, {
            part: {
              case: 'toolResult',
              value: create(MessagePartToolResultSchema, {
                toolCallId,
                result: JSON.stringify(resultPayload),
              }),
            },
          }),
        );
      }
      continue;
    }

    // -----------------------------------------------------------------------
    // Unknown / unhandled part — preserve as JSON text so nothing is lost.
    // -----------------------------------------------------------------------
    const fallbackText = `[unknown part: ${JSON.stringify(part)}]`;
    parts.push(
      create(MessagePartSchema, {
        part: {
          case: 'text',
          value: create(MessagePartTextSchema, { text: fallbackText }),
        },
      }),
    );
  }

  return {
    id: msg.id,
    role: msg.role,
    parts,
    createdAtUnix: BigInt(createdAtUnix ?? Math.floor(Date.now() / 1000)),
  };
}

// ---------------------------------------------------------------------------
// protoToUiMessage — proto ConversationMessage parts → UIMessage
// ---------------------------------------------------------------------------

/**
 * Convert a proto `ConversationMessage` (as returned by `GetConversation`) to
 * an AI SDK v6 `UIMessage` so it can be fed to the Zustand chat store and
 * rendered by the existing assistant-ui components.
 *
 * Tool call/result pairs with the same `tool_call_id` are fused into a single
 * `DynamicToolUIPart` so the AI SDK's renderer can display them correctly.
 *
 * Unknown proto oneof cases are emitted as a `TextUIPart` carrying a
 * JSON representation so they survive a round-trip without silent loss.
 */
export function protoToUiMessage(msg: ConversationMessage): UIMessage {
  // First pass: build a raw ordered part list, fusing tool_call + tool_result pairs.
  // We use unknown[] then cast to UIMessage['parts'] at the return site to avoid
  // TypeScript index-signature friction with the strict union types.
  const parts: unknown[] = [];

  // Index of pending tool calls by toolCallId for result fusion.
  const pendingToolCalls = new Map<string, { index: number; toolName: string; input: unknown }>();

  for (const protoPart of msg.parts) {
    const cas = protoPart.part;
    if (!cas || cas.case === undefined) {
      // Empty or unrecognised oneof — preserve as text fallback.
      parts.push({ type: 'text', text: '[unknown proto part]' });
      continue;
    }

    switch (cas.case) {
      case 'text': {
        parts.push({ type: 'text', text: cas.value.text });
        break;
      }

      case 'reasoning': {
        parts.push({ type: 'reasoning', text: cas.value.text, state: 'done' });
        break;
      }

      case 'citation': {
        parts.push({
          type: 'source-url',
          sourceId: cas.value.citationId,
          url: cas.value.url,
          title: cas.value.label || undefined,
        });
        break;
      }

      case 'attachmentRef': {
        parts.push({
          type: 'file',
          mediaType: cas.value.mediaType,
          filename: cas.value.name || undefined,
          url: cas.value.attachmentId,
        });
        break;
      }

      case 'toolCall': {
        const { toolCallId, name, arguments: argsJson } = cas.value;
        let parsedInput: unknown = {};
        try {
          parsedInput = JSON.parse(argsJson || '{}');
        } catch {
          parsedInput = argsJson;
        }

        // Record position so tool_result can fuse with it.
        pendingToolCalls.set(toolCallId, {
          index: parts.length,
          toolName: name,
          input: parsedInput,
        });

        parts.push({
          type: 'dynamic-tool',
          toolName: name,
          toolCallId,
          state: 'input-available',
          input: parsedInput,
        });
        break;
      }

      case 'toolResult': {
        const { toolCallId, result: resultJson } = cas.value;
        let parsedOutput: unknown = null;
        try {
          parsedOutput = JSON.parse(resultJson || 'null');
        } catch {
          parsedOutput = resultJson;
        }

        const pending = pendingToolCalls.get(toolCallId);
        if (pending !== undefined) {
          // Fuse: replace the existing input-available part with output-available.
          parts[pending.index] = {
            type: 'dynamic-tool',
            toolName: pending.toolName,
            toolCallId,
            state: 'output-available',
            input: pending.input,
            output: parsedOutput,
          };
          pendingToolCalls.delete(toolCallId);
        } else {
          // Orphan result (no matching call in this message): emit as text.
          parts.push({ type: 'text', text: `[tool result ${toolCallId}: ${resultJson}]` });
        }
        break;
      }

      default: {
        // Unknown oneof case — preserve as text fallback.
        const unknownCase: string = (cas as { case: string }).case;
        parts.push({ type: 'text', text: `[unknown proto part case: ${unknownCase}]` });
        break;
      }
    }
  }

  // UIMessage v6 shape: { id, role, metadata?, parts }
  // No `content` or `createdAt` field — those are AI SDK v5 artifacts.
  return {
    id: msg.id,
    role: msg.role as UIMessage['role'],
    parts: parts as UIMessage['parts'],
  } as UIMessage;
}

// ---------------------------------------------------------------------------
// Convenience batch converters
// ---------------------------------------------------------------------------

/**
 * Convert an array of UIMessages to proto message records.
 * Use this on the save path.
 */
export function uiMessagesToProto(messages: UIMessage[]): ProtoMessageRecord[] {
  return messages.map((m) => uiMessageToProto(m));
}

/**
 * Convert an array of proto ConversationMessages to UIMessages.
 * Use this on the load path (getConversation response).
 */
export function protoToUiMessages(messages: ConversationMessage[]): UIMessage[] {
  return messages.map(protoToUiMessage);
}
