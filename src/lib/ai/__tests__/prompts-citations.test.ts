/**
 * Tests for citation instruction injection in buildSystemPrompt.
 */
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../prompts';

// ============================================================================
// Minimal opts helpers
// ============================================================================

const baseOpts = {
  agentId: 'general',
};

const graphContextWithSummary = {
  focusNode: null,
  neighbors: [],
  summary: 'Node: example.com\nType: Domain\nRelationships: HAS_SUBDOMAIN → api.example.com',
};

// ============================================================================
// Citation instruction tests
// ============================================================================

describe('buildSystemPrompt — citation instructions', () => {
  it('includes the [cite:node:{nodeId}] instruction when nodeId is set and graphContext.summary is present', () => {
    const system = buildSystemPrompt({
      ...baseOpts,
      graphContext: graphContextWithSummary,
      nodeId: 'domain:example.com',
    });

    expect(system).toContain('[cite:node:domain:example.com]');
    expect(system).toContain('citation marker');
    expect(system).toContain('Only emit a citation if you actually used data from this node');
  });

  it('does NOT include citation instruction when nodeId is not set', () => {
    const system = buildSystemPrompt({
      ...baseOpts,
      graphContext: graphContextWithSummary,
    });

    expect(system).not.toContain('[cite:node:');
    expect(system).not.toContain('citation marker');
  });

  it('does NOT include citation instruction when nodeId is set but graphContext has no summary', () => {
    const system = buildSystemPrompt({
      ...baseOpts,
      graphContext: { focusNode: null, neighbors: [], summary: '' },
      nodeId: 'host:10.0.0.1',
    });

    expect(system).not.toContain('[cite:node:');
  });

  it('does NOT include citation instruction when neither nodeId nor graphContext is set', () => {
    const system = buildSystemPrompt(baseOpts);

    expect(system).not.toContain('[cite:node:');
  });

  it('includes the focused node summary text regardless of nodeId', () => {
    const system = buildSystemPrompt({
      ...baseOpts,
      graphContext: graphContextWithSummary,
    });

    expect(system).toContain(graphContextWithSummary.summary);
  });

  it('still includes the focused node summary text when nodeId is set', () => {
    const system = buildSystemPrompt({
      ...baseOpts,
      graphContext: graphContextWithSummary,
      nodeId: 'host:10.0.0.2',
    });

    expect(system).toContain(graphContextWithSummary.summary);
    expect(system).toContain('[cite:node:host:10.0.0.2]');
  });

  it('preserves all 7 context layers — nodeId does not remove any', () => {
    const system = buildSystemPrompt({
      ...baseOpts,
      graphContext: graphContextWithSummary,
      graphSummary: 'Tenant graph summary text',
      nodeId: 'finding:f-001',
    });

    // Layer 1: identity
    expect(system).toContain('Zero Root AI');
    // Layer 3: graph summary
    expect(system).toContain('Tenant graph summary text');
    // Layer 7: focused node + citation instruction
    expect(system).toContain(graphContextWithSummary.summary);
    expect(system).toContain('[cite:node:finding:f-001]');
  });
});
