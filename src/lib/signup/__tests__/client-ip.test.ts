// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI
/**
 * The signup budgets key on the address our outermost proxy wrote, never on
 * the leftmost X-Forwarded-For entry, which the caller writes.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

import { clientIpForDaemon } from '../client-ip';

const h = (entries: Record<string, string>) => new Headers(entries);

describe('clientIpForDaemon', () => {
  it('reads the entry the trusted proxy wrote (one hop)', () => {
    expect(clientIpForDaemon(h({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  // THE FIXTURE THIS EXISTS FOR.
  it('ignores a forged leftmost entry', () => {
    expect(
      clientIpForDaemon(h({ 'x-forwarded-for': '198.51.100.99, 203.0.113.7' })),
    ).toBe('203.0.113.7');
  });

  it('ignores x-real-ip behind a proxy', () => {
    expect(clientIpForDaemon(h({ 'x-real-ip': '198.51.100.99' }))).toBe('');
  });

  it('reports an unresolvable source as the empty string, never a placeholder', () => {
    expect(clientIpForDaemon(h({}))).toBe('');
    expect(clientIpForDaemon(h({ 'x-forwarded-for': 'not-an-ip' }))).toBe('');
  });
});
