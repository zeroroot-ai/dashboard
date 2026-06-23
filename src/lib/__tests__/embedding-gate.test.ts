import { describe, it, expect } from 'vitest';

import {
  isEmbeddingGateMessage,
  isEmbeddingGateError,
} from '@/src/lib/embedding-gate';

// The canonical daemon gate message (internal/engine/memory/embedder/errors.go).
const DAEMON_MESSAGE =
  'no embedding provider configured for this tenant — add one in Settings → Providers (vector recall, GraphRAG, belief-RAG and finding classification require an embedding provider)';

describe('embedding-gate', () => {
  describe('isEmbeddingGateMessage', () => {
    it('matches the verbatim daemon message', () => {
      expect(isEmbeddingGateMessage(DAEMON_MESSAGE)).toBe(true);
    });

    it('matches the shorter "configure an embedding provider" phrasing', () => {
      expect(isEmbeddingGateMessage('Please configure an embedding provider')).toBe(true);
    });

    it('is case-insensitive', () => {
      expect(isEmbeddingGateMessage('NO EMBEDDING PROVIDER CONFIGURED for tenant')).toBe(true);
    });

    it('does not match unrelated errors', () => {
      expect(isEmbeddingGateMessage('permission denied')).toBe(false);
      expect(isEmbeddingGateMessage('provider not found')).toBe(false);
      expect(isEmbeddingGateMessage('')).toBe(false);
      expect(isEmbeddingGateMessage(undefined)).toBe(false);
      expect(isEmbeddingGateMessage(null)).toBe(false);
    });
  });

  describe('isEmbeddingGateError', () => {
    it('detects a raw string', () => {
      expect(isEmbeddingGateError(DAEMON_MESSAGE)).toBe(true);
    });

    it('detects an Error / ConnectError-like object via .message', () => {
      expect(isEmbeddingGateError(new Error(DAEMON_MESSAGE))).toBe(true);
      expect(isEmbeddingGateError({ message: DAEMON_MESSAGE })).toBe(true);
    });

    it('detects a ConnectError-like object via .rawMessage', () => {
      expect(isEmbeddingGateError({ rawMessage: DAEMON_MESSAGE, message: 'wrapped' })).toBe(true);
    });

    it('detects the graph-route envelope `{ error: "<message>" }`', () => {
      expect(isEmbeddingGateError({ error: DAEMON_MESSAGE })).toBe(true);
    });

    it('detects the api-errors envelope `{ error: { message } }`', () => {
      expect(isEmbeddingGateError({ error: { message: DAEMON_MESSAGE } })).toBe(true);
    });

    it('returns false for unrelated errors and non-objects', () => {
      expect(isEmbeddingGateError(new Error('boom'))).toBe(false);
      expect(isEmbeddingGateError({ error: 'permission denied' })).toBe(false);
      expect(isEmbeddingGateError({ error: { message: 'not found' } })).toBe(false);
      expect(isEmbeddingGateError(null)).toBe(false);
      expect(isEmbeddingGateError(undefined)).toBe(false);
      expect(isEmbeddingGateError(42)).toBe(false);
    });
  });
});
