/**
 * Unit tests for the resolveProvider factory in src/lib/ai/provider.ts.
 *
 * The factory is a thin delegator to GibsonLLMAdapter, tests assert the
 * correct adapter is returned, error cases throw descriptively, and the
 * returned instance satisfies the LanguageModelV2 interface.
 */
import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Mock GibsonLLMAdapter before importing the module under test
// ============================================================================

const constructorSpy = vi.fn();

vi.mock('./gibson-llm-adapter', () => {
  class MockGibsonLLMAdapter {
    readonly specificationVersion = 'v2' as const;
    readonly provider = 'gibson';
    readonly modelId: string;
    readonly supportedUrls: Record<string, RegExp[]> = {};
    doGenerate = vi.fn();
    doStream = vi.fn();

    constructor(providerName: string, userId?: string, tenantId?: string) {
      this.modelId = `gibson:${providerName}`;
      constructorSpy(providerName, userId, tenantId);
    }
  }
  return { GibsonLLMAdapter: MockGibsonLLMAdapter };
});

// Import AFTER mock is established
import { resolveProvider } from './provider';
import { GibsonLLMAdapter } from './gibson-llm-adapter';

// ============================================================================
// Tests
// ============================================================================

describe('resolveProvider', () => {
  it('returns a GibsonLLMAdapter instance for a valid provider name', () => {
    const model = resolveProvider('anthropic');
    expect(model).toBeDefined();
    expect(model).toBeInstanceOf(GibsonLLMAdapter);
    expect(constructorSpy).toHaveBeenCalledWith('anthropic', undefined, undefined);
  });

  it('sets modelId to "gibson:<providerName>" on the returned adapter', () => {
    const model = resolveProvider('anthropic');
    expect(model.modelId).toBe('gibson:anthropic');
  });

  it('sets provider to "gibson" on the returned adapter', () => {
    const model = resolveProvider('openai');
    expect(model.provider).toBe('gibson');
  });

  it('forwards userId and tenantId opts to the adapter constructor', () => {
    resolveProvider('google', { userId: 'u-123', tenantId: 't-456' });
    expect(constructorSpy).toHaveBeenCalledWith('google', 'u-123', 't-456');
  });

  it('accepts opts with only tenantId set', () => {
    resolveProvider('bedrock', { tenantId: 't-789' });
    expect(constructorSpy).toHaveBeenCalledWith('bedrock', undefined, 't-789');
  });

  it('throws when providerName is an empty string', () => {
    expect(() => resolveProvider('')).toThrow('resolveProvider: providerName is required');
  });

  it('throws for "custom" provider type with a docs pointer', () => {
    expect(() => resolveProvider('custom')).toThrow(
      'resolveProvider: "custom" provider type is not resolvable from the dashboard; ' +
        'see docs/byok-providers.md for operator-side configuration.',
    );
  });

  it('works for all known non-custom provider names without throwing', () => {
    const providers = ['anthropic', 'openai', 'google', 'bedrock', 'ollama', 'mistral', 'groq', 'cohere', 'xai', 'deepseek'];
    for (const name of providers) {
      expect(() => resolveProvider(name)).not.toThrow();
    }
  });

  it('returns an object that satisfies the LanguageModelV2 interface shape', () => {
    const model = resolveProvider('anthropic');
    expect(model.specificationVersion).toBe('v2');
    expect(typeof model.doGenerate).toBe('function');
    expect(typeof model.doStream).toBe('function');
  });
});
