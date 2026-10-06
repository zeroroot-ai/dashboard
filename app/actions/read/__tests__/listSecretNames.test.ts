// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * listSecretNamesAction follows the daemon's page tokens to the last page
 * (dashboard#245, sdk#232).
 */

import { describe, it, expect, vi } from 'vitest';

const { mockListSecrets } = vi.hoisted(() => ({ mockListSecrets: vi.fn() }));

vi.mock('@/src/lib/auth', () => ({
  getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })),
}));
vi.mock('@/src/lib/gibson-client/secrets', () => ({
  listSecrets: mockListSecrets,
}));

import { listSecretNamesAction } from '../listSecretNames';

describe('listSecretNamesAction', () => {
  it('reads each page until the daemon returns no next token', async () => {
    mockListSecrets
      .mockResolvedValueOnce({ secrets: [{ name: 'b' }], nextPageToken: 'tok-2' })
      .mockResolvedValueOnce({ secrets: [{ name: 'a' }], nextPageToken: '' });

    const result = await listSecretNamesAction();

    expect(result).toEqual({ ok: true, data: ['a', 'b'] });
    expect(mockListSecrets).toHaveBeenNthCalledWith(1, { pageSize: 200, pageToken: '' });
    expect(mockListSecrets).toHaveBeenNthCalledWith(2, { pageSize: 200, pageToken: 'tok-2' });
  });
});
