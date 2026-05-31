/**
 * Message Normalizer — pure round-trip table tests.
 *
 * Spec: dashboard#548 (Module 3), closes dashboard#550.
 *
 * Coverage:
 *   - Every named proto part type round-trips UIMessage → proto → UIMessage
 *     with zero loss and preserved ordering (full round-trip table).
 *   - Each part type tested individually for save-path fidelity.
 *   - Unknown proto oneof case handled explicitly (assert fallback text, not silent drop).
 *   - Unknown UIMessage part type handled explicitly (assert fallback text, not silent drop).
 *   - Tool-call / tool-result fusion: adjacent pair with same toolCallId fuses correctly.
 *   - Lone tool_call (no result) round-trips as input-available state.
 *   - Ordering is preserved across all part types in a mixed message.
 */

import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import type { ConversationMessage } from '@/src/gen/gibson/user/v1/user_pb';
import { create } from '@bufbuild/protobuf';
import {
  ConversationMessageSchema,
  MessagePartSchema,
  MessagePartTextSchema,
  MessagePartToolCallSchema,
  MessagePartToolResultSchema,
  MessagePartCitationSchema,
  MessagePartAttachmentRefSchema,
  MessagePartReasoningSchema,
} from '@/src/gen/gibson/user/v1/user_pb';
import {
  uiMessageToProto,
  protoToUiMessage,
  uiMessagesToProto,
  protoToUiMessages,
} from '../message-normalizer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUiMsg(overrides: Partial<UIMessage> & { parts: UIMessage['parts'] }): UIMessage {
  return {
    id: 'test-msg-1',
    role: 'assistant',
    ...overrides,
  } as UIMessage;
}

function makeProtoMsg(overrides: {
  id?: string;
  role?: string;
  createdAtUnix?: bigint;
  parts?: ConversationMessage['parts'];
}): ConversationMessage {
  // Materialise a ConversationMessage from already-created MessagePart objects.
  // create() expects MessageInit, but an already-initialised proto message is
  // structurally compatible at runtime. Cast through unknown to satisfy the
  // generic variance constraint.
  const msg = create(ConversationMessageSchema, {
    id: overrides.id ?? 'test-msg-1',
    role: overrides.role ?? 'assistant',
    createdAtUnix: overrides.createdAtUnix ?? BigInt(1700000000),
  }) as ConversationMessage;
  if (overrides.parts) {
    (msg as { parts: ConversationMessage['parts'] }).parts = overrides.parts;
  }
  return msg;
}

/**
 * Build a ConversationMessage from a ProtoMessageRecord (output of uiMessageToProto).
 * Used in round-trip tests where the parts are already-created MessagePart objects.
 */
function recordToProtoMsg(record: ReturnType<typeof uiMessageToProto>): ConversationMessage {
  const msg = create(ConversationMessageSchema, {
    id: record.id,
    role: record.role,
    createdAtUnix: record.createdAtUnix,
  }) as ConversationMessage;
  (msg as { parts: ConversationMessage['parts'] }).parts = record.parts;
  return msg;
}

// ---------------------------------------------------------------------------
// Individual part type — save path (UIMessage → proto)
// ---------------------------------------------------------------------------

describe('uiMessageToProto — save path', () => {
  it('maps a text part to MessagePartText', () => {
    const msg = makeUiMsg({
      parts: [{ type: 'text', text: 'Hello world' }],
    });
    const record = uiMessageToProto(msg);
    expect(record.parts).toHaveLength(1);
    const p = record.parts[0].part;
    expect(p?.case).toBe('text');
    if (p?.case === 'text') {
      expect(p.value.text).toBe('Hello world');
    }
  });

  it('maps a reasoning part to MessagePartReasoning', () => {
    const msg = makeUiMsg({
      parts: [{ type: 'reasoning', text: 'Let me think…', state: 'done' }],
    });
    const record = uiMessageToProto(msg);
    expect(record.parts).toHaveLength(1);
    const p = record.parts[0].part;
    expect(p?.case).toBe('reasoning');
    if (p?.case === 'reasoning') {
      expect(p.value.text).toBe('Let me think…');
    }
  });

  it('maps a source-url part to MessagePartCitation', () => {
    const msg = makeUiMsg({
      parts: [{ type: 'source-url', sourceId: 'node-abc', url: '/graph?node=abc', title: 'Host abc' }],
    });
    const record = uiMessageToProto(msg);
    expect(record.parts).toHaveLength(1);
    const p = record.parts[0].part;
    expect(p?.case).toBe('citation');
    if (p?.case === 'citation') {
      expect(p.value.citationId).toBe('node-abc');
      expect(p.value.url).toBe('/graph?node=abc');
      expect(p.value.label).toBe('Host abc');
    }
  });

  it('maps a file part to MessagePartAttachmentRef', () => {
    const msg = makeUiMsg({
      parts: [{ type: 'file', mediaType: 'image/png', filename: 'screenshot.png', url: 'att-id-001' }],
    });
    const record = uiMessageToProto(msg);
    expect(record.parts).toHaveLength(1);
    const p = record.parts[0].part;
    expect(p?.case).toBe('attachmentRef');
    if (p?.case === 'attachmentRef') {
      expect(p.value.attachmentId).toBe('att-id-001');
      expect(p.value.mediaType).toBe('image/png');
      expect(p.value.name).toBe('screenshot.png');
    }
  });

  it('maps a dynamic-tool part with output to MessagePartToolCall + MessagePartToolResult', () => {
    const msg = makeUiMsg({
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'nmap',
          toolCallId: 'tc-001',
          state: 'output-available',
          input: { target: '10.0.0.1' },
          output: { open_ports: [22, 80] },
        },
      ],
    });
    const record = uiMessageToProto(msg);
    expect(record.parts).toHaveLength(2);

    const call = record.parts[0].part;
    expect(call?.case).toBe('toolCall');
    if (call?.case === 'toolCall') {
      expect(call.value.toolCallId).toBe('tc-001');
      expect(call.value.name).toBe('nmap');
      expect(JSON.parse(call.value.arguments)).toEqual({ target: '10.0.0.1' });
    }

    const result = record.parts[1].part;
    expect(result?.case).toBe('toolResult');
    if (result?.case === 'toolResult') {
      expect(result.value.toolCallId).toBe('tc-001');
      expect(JSON.parse(result.value.result)).toEqual({ open_ports: [22, 80] });
    }
  });

  it('maps a dynamic-tool part in input-available state to MessagePartToolCall only (no result)', () => {
    const msg = makeUiMsg({
      parts: [
        {
          type: 'dynamic-tool',
          toolName: 'nmap',
          toolCallId: 'tc-002',
          state: 'input-available',
          input: { target: '10.0.0.2' },
        },
      ],
    });
    const record = uiMessageToProto(msg);
    expect(record.parts).toHaveLength(1);
    const call = record.parts[0].part;
    expect(call?.case).toBe('toolCall');
  });

  it('skips step-start parts', () => {
    const msg = makeUiMsg({
      parts: [
        { type: 'step-start' },
        { type: 'text', text: 'after step' },
      ],
    });
    const record = uiMessageToProto(msg);
    expect(record.parts).toHaveLength(1);
    expect(record.parts[0].part?.case).toBe('text');
  });

  it('preserves unknown UIMessage part type as JSON text fallback (not silently dropped)', () => {
    const msg = makeUiMsg({
      parts: [
        { type: 'totally-unknown-future-type', someField: 42 } as unknown as UIMessage['parts'][0],
        { type: 'text', text: 'after unknown' },
      ],
    });
    const record = uiMessageToProto(msg);
    expect(record.parts).toHaveLength(2);

    const fallback = record.parts[0].part;
    expect(fallback?.case).toBe('text');
    if (fallback?.case === 'text') {
      // Must contain recognisable representation of the unknown part.
      expect(fallback.value.text).toContain('unknown part');
      expect(fallback.value.text).toContain('totally-unknown-future-type');
    }

    // The following part is still present — unknown does NOT consume the rest.
    const next = record.parts[1].part;
    expect(next?.case).toBe('text');
    if (next?.case === 'text') {
      expect(next.value.text).toBe('after unknown');
    }
  });
});

// ---------------------------------------------------------------------------
// Individual part type — load path (proto → UIMessage)
// ---------------------------------------------------------------------------

describe('protoToUiMessage — load path', () => {
  it('maps MessagePartText to a TextUIPart', () => {
    const msg = makeProtoMsg({
      parts: [
        create(MessagePartSchema, {
          part: { case: 'text', value: create(MessagePartTextSchema, { text: 'Hello' }) },
        }),
      ],
    });
    const ui = protoToUiMessage(msg);
    expect(ui.parts).toHaveLength(1);
    expect(ui.parts[0]).toMatchObject({ type: 'text', text: 'Hello' });
  });

  it('maps MessagePartReasoning to a ReasoningUIPart', () => {
    const msg = makeProtoMsg({
      parts: [
        create(MessagePartSchema, {
          part: { case: 'reasoning', value: create(MessagePartReasoningSchema, { text: 'reasoning' }) },
        }),
      ],
    });
    const ui = protoToUiMessage(msg);
    expect(ui.parts).toHaveLength(1);
    expect(ui.parts[0]).toMatchObject({ type: 'reasoning', text: 'reasoning' });
  });

  it('maps MessagePartCitation to a SourceUrlUIPart', () => {
    const msg = makeProtoMsg({
      parts: [
        create(MessagePartSchema, {
          part: {
            case: 'citation',
            value: create(MessagePartCitationSchema, {
              citationId: 'node-xyz',
              label: 'Target node',
              url: '/graph?node=xyz',
            }),
          },
        }),
      ],
    });
    const ui = protoToUiMessage(msg);
    expect(ui.parts).toHaveLength(1);
    expect(ui.parts[0]).toMatchObject({
      type: 'source-url',
      sourceId: 'node-xyz',
      title: 'Target node',
      url: '/graph?node=xyz',
    });
  });

  it('maps MessagePartAttachmentRef to a FileUIPart', () => {
    const msg = makeProtoMsg({
      parts: [
        create(MessagePartSchema, {
          part: {
            case: 'attachmentRef',
            value: create(MessagePartAttachmentRefSchema, {
              attachmentId: 'att-001',
              mediaType: 'application/pdf',
              name: 'report.pdf',
            }),
          },
        }),
      ],
    });
    const ui = protoToUiMessage(msg);
    expect(ui.parts).toHaveLength(1);
    expect(ui.parts[0]).toMatchObject({
      type: 'file',
      url: 'att-001',
      mediaType: 'application/pdf',
      filename: 'report.pdf',
    });
  });

  it('fuses adjacent tool_call + tool_result with same toolCallId into a single DynamicToolUIPart', () => {
    const msg = makeProtoMsg({
      parts: [
        create(MessagePartSchema, {
          part: {
            case: 'toolCall',
            value: create(MessagePartToolCallSchema, {
              toolCallId: 'tc-001',
              name: 'nmap',
              arguments: '{"target":"10.0.0.1"}',
            }),
          },
        }),
        create(MessagePartSchema, {
          part: {
            case: 'toolResult',
            value: create(MessagePartToolResultSchema, {
              toolCallId: 'tc-001',
              result: '{"open_ports":[22,80]}',
            }),
          },
        }),
      ],
    });
    const ui = protoToUiMessage(msg);
    // Two proto parts fuse into ONE UI part.
    expect(ui.parts).toHaveLength(1);
    expect(ui.parts[0]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'nmap',
      toolCallId: 'tc-001',
      state: 'output-available',
      input: { target: '10.0.0.1' },
      output: { open_ports: [22, 80] },
    });
  });

  it('maps a lone tool_call (no result) to DynamicToolUIPart with state=input-available', () => {
    const msg = makeProtoMsg({
      parts: [
        create(MessagePartSchema, {
          part: {
            case: 'toolCall',
            value: create(MessagePartToolCallSchema, {
              toolCallId: 'tc-002',
              name: 'traceroute',
              arguments: '{}',
            }),
          },
        }),
      ],
    });
    const ui = protoToUiMessage(msg);
    expect(ui.parts).toHaveLength(1);
    expect(ui.parts[0]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'traceroute',
      toolCallId: 'tc-002',
      state: 'input-available',
    });
  });

  it('maps an orphan tool_result (no matching call) to a text fallback (not silently dropped)', () => {
    const msg = makeProtoMsg({
      parts: [
        create(MessagePartSchema, {
          part: {
            case: 'toolResult',
            value: create(MessagePartToolResultSchema, {
              toolCallId: 'orphan-001',
              result: '{"x":1}',
            }),
          },
        }),
      ],
    });
    const ui = protoToUiMessage(msg);
    expect(ui.parts).toHaveLength(1);
    expect(ui.parts[0]).toMatchObject({ type: 'text' });
    expect((ui.parts[0] as { type: string; text: string }).text).toContain('orphan-001');
  });

  it('handles unknown proto oneof case explicitly (not silently dropped)', () => {
    // Simulate a proto part with no recognised case (e.g. future schema).
    // In Connect-ES, an unset oneof produces { case: undefined }.
    const msg = makeProtoMsg({
      // Empty part — cas.case will be undefined
      parts: [create(MessagePartSchema, {})],
    });
    const ui = protoToUiMessage(msg);
    expect(ui.parts).toHaveLength(1);
    // Must produce SOMETHING — never silently omit.
    expect(ui.parts[0].type).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Full round-trip — UIMessage → proto → UIMessage
// ---------------------------------------------------------------------------

describe('full round-trip: UIMessage → proto → UIMessage', () => {
  it('round-trips a message with all part types with zero loss and preserved ordering', () => {
    const original = makeUiMsg({
      id: 'rt-msg-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Here is the analysis.' },
        {
          type: 'dynamic-tool',
          toolName: 'scanner',
          toolCallId: 'tc-rt-1',
          state: 'output-available',
          input: { target: '192.168.1.1' },
          output: { ports: [443] },
        },
        { type: 'reasoning', text: 'I reasoned about this.', state: 'done' },
        { type: 'source-url', sourceId: 'node-rt-1', url: '/graph?n=rt-1', title: 'Service A' },
        { type: 'file', mediaType: 'text/plain', filename: 'logs.txt', url: 'att-rt-1' },
      ],
    });

    const protoRecord = uiMessageToProto(original, 1700000000);
    const restored = protoToUiMessage(recordToProtoMsg(protoRecord));

    // Identity fields
    expect(restored.id).toBe(original.id);
    expect(restored.role).toBe(original.role);

    // The tool part (2 proto parts) fuses back to 1 UI part, so total count
    // matches the original 5 parts (text + tool + reasoning + citation + file).
    expect(restored.parts).toHaveLength(5);

    // Part 0: text
    expect(restored.parts[0]).toMatchObject({ type: 'text', text: 'Here is the analysis.' });

    // Part 1: tool (fused)
    expect(restored.parts[1]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'scanner',
      toolCallId: 'tc-rt-1',
      state: 'output-available',
      input: { target: '192.168.1.1' },
      output: { ports: [443] },
    });

    // Part 2: reasoning
    expect(restored.parts[2]).toMatchObject({ type: 'reasoning', text: 'I reasoned about this.' });

    // Part 3: citation
    expect(restored.parts[3]).toMatchObject({
      type: 'source-url',
      sourceId: 'node-rt-1',
      url: '/graph?n=rt-1',
      title: 'Service A',
    });

    // Part 4: attachment
    expect(restored.parts[4]).toMatchObject({
      type: 'file',
      mediaType: 'text/plain',
      filename: 'logs.txt',
      url: 'att-rt-1',
    });
  });

  it('round-trips a user message with only a text part', () => {
    const original = makeUiMsg({
      id: 'user-msg-1',
      role: 'user',
      parts: [{ type: 'text', text: 'What hosts are vulnerable?' }],
    });

    const protoRecord = uiMessageToProto(original, 1700000001);
    const restored = protoToUiMessage(
      create(ConversationMessageSchema, {
        id: protoRecord.id,
        role: protoRecord.role,
        parts: protoRecord.parts,
        createdAtUnix: protoRecord.createdAtUnix,
      }),
    );

    expect(restored.role).toBe('user');
    expect(restored.parts).toHaveLength(1);
    expect(restored.parts[0]).toMatchObject({ type: 'text', text: 'What hosts are vulnerable?' });
  });

  it('round-trips an unknown UIMessage part type — fallback text is preserved', () => {
    const original = makeUiMsg({
      id: 'unk-msg-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'before' },
        {
          type: 'future-widget',
          widgetData: { color: 'red' },
        } as unknown as UIMessage['parts'][0],
        { type: 'text', text: 'after' },
      ],
    });

    const protoRecord = uiMessageToProto(original, 1700000002);
    const restored = protoToUiMessage(
      create(ConversationMessageSchema, {
        id: protoRecord.id,
        role: protoRecord.role,
        parts: protoRecord.parts,
        createdAtUnix: protoRecord.createdAtUnix,
      }),
    );

    // 3 parts — nothing dropped.
    expect(restored.parts).toHaveLength(3);
    expect(restored.parts[0]).toMatchObject({ type: 'text', text: 'before' });
    // Middle part survived as a text fallback.
    const mid = restored.parts[1] as { type: string; text: string };
    expect(mid.type).toBe('text');
    expect(mid.text).toContain('unknown part');
    expect(mid.text).toContain('future-widget');
    expect(restored.parts[2]).toMatchObject({ type: 'text', text: 'after' });
  });

  it('preserves ordering of multiple tool pairs with interleaved text', () => {
    const original = makeUiMsg({
      id: 'order-msg-1',
      role: 'assistant',
      parts: [
        { type: 'text', text: 'Starting scan.' },
        {
          type: 'dynamic-tool',
          toolName: 'nmap',
          toolCallId: 'tc-a',
          state: 'output-available',
          input: { host: 'a' },
          output: { ports: [22] },
        },
        { type: 'text', text: 'Scan done. Now checking vuln.' },
        {
          type: 'dynamic-tool',
          toolName: 'vuln-check',
          toolCallId: 'tc-b',
          state: 'output-available',
          input: { host: 'a', port: 22 },
          output: { cve: 'CVE-2024-1234' },
        },
        { type: 'text', text: 'Found a vulnerability.' },
      ],
    });

    const protoRecord = uiMessageToProto(original, 1700000003);
    const restored = protoToUiMessage(
      create(ConversationMessageSchema, {
        id: protoRecord.id,
        role: protoRecord.role,
        parts: protoRecord.parts,
        createdAtUnix: protoRecord.createdAtUnix,
      }),
    );

    expect(restored.parts).toHaveLength(5);
    expect(restored.parts[0]).toMatchObject({ type: 'text', text: 'Starting scan.' });
    expect(restored.parts[1]).toMatchObject({ type: 'dynamic-tool', toolName: 'nmap', toolCallId: 'tc-a' });
    expect(restored.parts[2]).toMatchObject({ type: 'text', text: 'Scan done. Now checking vuln.' });
    expect(restored.parts[3]).toMatchObject({ type: 'dynamic-tool', toolName: 'vuln-check', toolCallId: 'tc-b' });
    expect(restored.parts[4]).toMatchObject({ type: 'text', text: 'Found a vulnerability.' });
  });
});

// ---------------------------------------------------------------------------
// Batch converters
// ---------------------------------------------------------------------------

describe('uiMessagesToProto / protoToUiMessages — batch converters', () => {
  it('batch-converts an array of messages and round-trips all of them', () => {
    const msgs: UIMessage[] = [
      makeUiMsg({ id: 'b-1', role: 'user', parts: [{ type: 'text', text: 'Hello' }] }),
      makeUiMsg({
        id: 'b-2',
        role: 'assistant',
        parts: [
          { type: 'text', text: 'World' },
          { type: 'reasoning', text: 'thoughts', state: 'done' },
        ],
      }),
    ];

    const protoRecords = uiMessagesToProto(msgs);
    const protoMsgs = protoRecords.map((r) =>
      create(ConversationMessageSchema, {
        id: r.id,
        role: r.role,
        parts: r.parts,
        createdAtUnix: r.createdAtUnix,
      }),
    );
    const restored = protoToUiMessages(protoMsgs);

    expect(restored).toHaveLength(2);
    expect(restored[0].id).toBe('b-1');
    expect(restored[1].id).toBe('b-2');
    expect(restored[1].parts).toHaveLength(2);
    expect(restored[1].parts[1]).toMatchObject({ type: 'reasoning', text: 'thoughts' });
  });
});
