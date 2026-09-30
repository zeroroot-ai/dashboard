// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect } from 'vitest';
import { principalLabel, userIdsToResolve, REMOVED_USER_LABEL, type UserRefView } from '../label';
import { principalViewFromRef } from '@/src/lib/gibson-client/principal';

const refs = new Map<string, UserRefView>([
  ['alice', { userId: 'alice', state: 'member', displayName: 'Alice Ng', email: 'alice@example.com' }],
  ['mail', { userId: 'mail', state: 'member', displayName: '', email: 'mail@example.com' }],
  ['gone', { userId: 'gone', state: 'removed', displayName: '', email: '' }],
]);

describe('principalLabel', () => {
  it('names a member, says "removed user" for a person who left, and keeps the id while loading', () => {
    expect(principalLabel({ kind: 'user', id: 'alice' }, 'me', refs)).toBe('Alice Ng');
    expect(principalLabel({ kind: 'user', id: 'mail' }, 'me', refs)).toBe('mail@example.com');
    expect(principalLabel({ kind: 'user', id: 'gone' }, 'me', refs)).toBe(REMOVED_USER_LABEL);
    expect(principalLabel({ kind: 'user', id: 'pending' }, 'me', refs)).toBe('user pending');
    expect(principalLabel({ kind: 'user', id: 'pending' }, 'me', undefined)).toBe('user pending');
  });
  it('says "me" for the signed-in person and names the other kinds', () => {
    expect(principalLabel({ kind: 'user', id: 'me' }, 'me', refs)).toBe('me');
    expect(principalLabel({ kind: 'component', id: 'agent_principal:acme/recon' }, 'me', refs)).toBe('component agent_principal:acme/recon');
    expect(principalLabel({ kind: 'service', id: 's' }, 'me', refs)).toBe('platform');
    expect(principalLabel({ kind: 'tenant', id: 't' }, 'me', refs)).toBe('tenant');
    expect(principalLabel({ kind: 'unknown', id: '' }, 'me', refs)).toBe('unknown');
  });
});

describe('userIdsToResolve', () => {
  it('collects distinct user ids, skips mine and the other kinds', () => {
    expect(
      userIdsToResolve(
        [
          { kind: 'user', id: 'b' },
          { kind: 'user', id: 'a' },
          { kind: 'user', id: 'b' },
          { kind: 'user', id: 'me' },
          { kind: 'component', id: 'c' },
          undefined,
        ],
        'me',
      ),
    ).toEqual(['a', 'b']);
  });
});

describe('principalViewFromRef', () => {
  it('reads the FGA user reference a finding carries', () => {
    expect(principalViewFromRef('user:123')).toEqual({ kind: 'user', id: '123' });
    expect(principalViewFromRef('agent_principal:acme/recon')).toEqual({ kind: 'component', id: 'agent_principal:acme/recon' });
    expect(principalViewFromRef('tool_principal:acme/nmap')?.kind).toBe('component');
    expect(principalViewFromRef('')).toBeUndefined();
    expect(principalViewFromRef('odd')).toEqual({ kind: 'unknown', id: 'odd' });
  });
});
