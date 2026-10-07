// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * @vitest-environment node
 *
 * The audit log client (lane 11 row G23): it reads actor_id, actor_source
 * and target_object, and passes the cursor.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../gibson-client', () => ({ userClient: () => ({ listAuditEvents: list }) }));

import { daemonListAuditRecords } from '../audit-log';

describe('daemonListAuditRecords', () => {
  it('maps the actor and the target of each record', async () => {
    list.mockResolvedValue({
      events: [
        {
          eventType: 'secret.read',
          timestamp: '2026-10-01T09:30:00Z',
          actorEmail: '',
          tenantId: 't1',
          targetUserId: '',
          details: {},
          traceId: 'tr',
          actorSource: 'agent',
          actorId: 'spiffe://x/agent',
          targetObject: 'secret:db',
        },
      ],
      nextCursor: 'c2',
    });
    await expect(daemonListAuditRecords('c1')).resolves.toEqual({
      records: [
        {
          eventType: 'secret.read',
          timestamp: '2026-10-01T09:30:00Z',
          actorId: 'spiffe://x/agent',
          actorEmail: '',
          actorSource: 'agent',
          targetObject: 'secret:db',
          traceId: 'tr',
        },
      ],
      nextCursor: 'c2',
    });
    expect(list).toHaveBeenCalledWith({ limit: 100, cursor: 'c1' });
  });
});
