import { describe, it, expect } from 'vitest';
import { PERSONAS, PERSONAS_LIST, getPersona } from '../personas';

describe('personas', () => {
  it('every persona ID is unique', () => {
    const ids = PERSONAS_LIST.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('PERSONAS map has all 10 expected IDs', () => {
    const expectedIds = [
      'general',
      'recon',
      'exploit',
      'analysis',
      'remediation',
      'pentest-lead',
      'ciso',
      'soc-analyst',
      'developer',
      'compliance',
    ];
    for (const id of expectedIds) {
      expect(PERSONAS).toHaveProperty(id);
    }
  });

  it('every persona has a non-empty label', () => {
    for (const persona of PERSONAS_LIST) {
      expect(persona.label, `persona ${persona.id} missing label`).toBeTruthy();
    }
  });

  it('every persona has a non-empty description', () => {
    for (const persona of PERSONAS_LIST) {
      expect(persona.description, `persona ${persona.id} missing description`).toBeTruthy();
    }
  });

  it('every persona has a non-empty systemPrompt', () => {
    for (const persona of PERSONAS_LIST) {
      expect(
        persona.systemPrompt.trim().length,
        `persona ${persona.id} has empty systemPrompt`,
      ).toBeGreaterThan(0);
    }
  });

  it('every persona has at least one suggested prompt', () => {
    for (const persona of PERSONAS_LIST) {
      expect(
        persona.suggestedPrompts.length,
        `persona ${persona.id} has no suggestedPrompts`,
      ).toBeGreaterThanOrEqual(1);
      for (const prompt of persona.suggestedPrompts) {
        expect(prompt.trim().length, `persona ${persona.id} has empty suggestedPrompt`).toBeGreaterThan(0);
      }
    }
  });

  it('getPersona returns the correct persona for a known ID', () => {
    const persona = getPersona('recon');
    expect(persona.id).toBe('recon');
    expect(persona.label).toBe('Recon Specialist');
  });

  it('getPersona falls back to general for an unknown ID', () => {
    const fallback = getPersona('nonexistent');
    expect(fallback.id).toBe('general');
  });

  it('getPersona falls back to general for empty string', () => {
    const fallback = getPersona('');
    expect(fallback.id).toBe('general');
  });

  it('PERSONAS_LIST and PERSONAS map are consistent', () => {
    for (const persona of PERSONAS_LIST) {
      expect(PERSONAS[persona.id]).toStrictEqual(persona);
    }
    expect(Object.keys(PERSONAS).length).toBe(PERSONAS_LIST.length);
  });
});
