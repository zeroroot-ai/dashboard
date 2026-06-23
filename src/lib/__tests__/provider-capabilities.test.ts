import { describe, it, expect } from 'vitest';

import {
  PROTO_CAPABILITY,
  PROVIDER_CAPABILITIES,
  capabilityLabel,
  toProtoCapabilities,
  fromProtoCapabilities,
  hasChatCapability,
  hasEmbeddingCapability,
  anyProviderServesEmbedding,
} from '@/src/lib/provider-capabilities';

describe('provider-capabilities', () => {
  describe('toProtoCapabilities', () => {
    it('maps chat and embedding to the proto enum values', () => {
      expect(toProtoCapabilities(['chat'])).toEqual([PROTO_CAPABILITY.CHAT]);
      expect(toProtoCapabilities(['embedding'])).toEqual([PROTO_CAPABILITY.EMBEDDING]);
      expect(toProtoCapabilities(['chat', 'embedding'])).toEqual([
        PROTO_CAPABILITY.CHAT,
        PROTO_CAPABILITY.EMBEDDING,
      ]);
    });

    it('yields an empty array for empty input (legacy chat-only default)', () => {
      expect(toProtoCapabilities([])).toEqual([]);
    });
  });

  describe('fromProtoCapabilities', () => {
    it('maps proto enum values back to capability strings', () => {
      expect(fromProtoCapabilities([PROTO_CAPABILITY.CHAT])).toEqual(['chat']);
      expect(fromProtoCapabilities([PROTO_CAPABILITY.EMBEDDING])).toEqual(['embedding']);
      expect(
        fromProtoCapabilities([PROTO_CAPABILITY.EMBEDDING, PROTO_CAPABILITY.CHAT]),
      ).toEqual(['chat', 'embedding']);
    });

    it('normalises an empty proto list to chat-only (legacy default)', () => {
      expect(fromProtoCapabilities([])).toEqual(['chat']);
    });

    it('drops UNSPECIFIED and de-duplicates', () => {
      expect(
        fromProtoCapabilities([
          PROTO_CAPABILITY.UNSPECIFIED,
          PROTO_CAPABILITY.CHAT,
          PROTO_CAPABILITY.CHAT,
        ]),
      ).toEqual(['chat']);
    });

    it('round-trips through toProtoCapabilities', () => {
      for (const caps of [['chat'], ['embedding'], ['chat', 'embedding']] as const) {
        expect(fromProtoCapabilities(toProtoCapabilities([...caps]))).toEqual([...caps]);
      }
    });
  });

  describe('predicates', () => {
    it('hasChatCapability / hasEmbeddingCapability', () => {
      expect(hasChatCapability(['chat'])).toBe(true);
      expect(hasChatCapability(['embedding'])).toBe(false);
      expect(hasEmbeddingCapability(['chat', 'embedding'])).toBe(true);
      expect(hasEmbeddingCapability(['chat'])).toBe(false);
    });

    it('anyProviderServesEmbedding', () => {
      expect(
        anyProviderServesEmbedding([
          { capabilities: ['chat'] },
          { capabilities: ['chat', 'embedding'] },
        ]),
      ).toBe(true);
      expect(
        anyProviderServesEmbedding([{ capabilities: ['chat'] }, { capabilities: ['chat'] }]),
      ).toBe(false);
      expect(anyProviderServesEmbedding([{}])).toBe(false);
      expect(anyProviderServesEmbedding([])).toBe(false);
    });
  });

  describe('capabilityLabel', () => {
    it('returns a human label for each capability', () => {
      expect(capabilityLabel('chat')).toMatch(/chat/i);
      expect(capabilityLabel('embedding')).toMatch(/embedding/i);
    });
  });

  it('exposes the two capabilities in display order', () => {
    expect([...PROVIDER_CAPABILITIES]).toEqual(['chat', 'embedding']);
  });
});
