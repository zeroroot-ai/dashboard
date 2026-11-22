// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * @vitest-environment node
 *
 * The compliance client (dashboard#224): which enabled packs are compliance
 * packs, and the evidence read over every page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';

vi.mock('server-only', () => ({}));

const { mockList, mockPacks } = vi.hoisted(() => ({ mockList: vi.fn(), mockPacks: vi.fn() }));
vi.mock('../../gibson-client', () => ({
  userClient: () => ({ listComplianceEvidence: mockList }),
}));
vi.mock('../domain-packs', () => ({ daemonListDomainPacks: mockPacks }));

import {
  daemonListCompliancePacks,
  daemonListComplianceEvidence,
  daemonListControlCoverage,
} from '../compliance';
import { ControlEvidence_State } from '@/src/gen/gibson/tenant/v1/compliance_pb';

beforeEach(() => {
  mockList.mockReset();
  mockPacks.mockReset();
});

describe('daemonListCompliancePacks', () => {
  it('keeps the enabled packs that the daemon reads as frameworks', async () => {
    mockPacks.mockResolvedValue([{ name: 'nist' }, { name: 'web' }, { name: 'gone' }]);
    mockList.mockImplementation(async ({ pack }: { pack: string }) => {
      if (pack === 'web') throw new ConnectError('no control list', Code.NotFound);
      if (pack === 'gone') throw new ConnectError('not enabled', Code.FailedPrecondition);
      return { controls: [], events: [], nextPageToken: '' };
    });
    await expect(daemonListCompliancePacks()).resolves.toEqual(['nist']);
  });

  it('passes a denial through', async () => {
    mockPacks.mockResolvedValue([{ name: 'nist' }]);
    mockList.mockRejectedValue(new ConnectError('denied', Code.PermissionDenied));
    await expect(daemonListCompliancePacks()).rejects.toThrow('denied');
  });
});

describe('daemonListComplianceEvidence', () => {
  it('reads the controls once and the events of every page', async () => {
    const page = (token: string, ids: string[], next: string) => ({
      pack: 'nist',
      packVersion: 1,
      controlsWithRule: 1,
      controlsTotal: 1,
      controls: [
        {
          controlId: 'AC-2',
          title: 't',
          family: 'AC',
          familyTitle: 'Access Control',
          state: ControlEvidence_State.HAS_EVIDENCE,
          eventCount: BigInt(ids.length),
          lastEventTime: undefined,
        },
      ],
      events: ids.map((id) => ({
        auditRecordId: id,
        time: { seconds: BigInt(0), nanos: 0 },
        action: 'a',
        actorId: 'u',
        resourceType: 'r',
        resourceId: 'x',
        controlIds: ['AC-2'],
      })),
      nextPageToken: next,
      token,
    });
    mockList
      .mockResolvedValueOnce(page('', ['e1'], 'p2'))
      .mockResolvedValueOnce(page('p2', ['e2'], ''));

    const out = await daemonListComplianceEvidence({
      pack: 'nist',
      start: new Date(0),
      end: new Date(1000),
    });

    expect(out.controls).toHaveLength(1);
    expect(out.controls[0].state).toBe('has_evidence');
    expect(out.events.map((e) => e.auditRecordId)).toEqual(['e1', 'e2']);
    expect(mockList.mock.calls[1][0].pageToken).toBe('p2');
  });
});

describe('daemonListControlCoverage', () => {
  it('reads one page of one event and returns the controls only', async () => {
    mockList.mockResolvedValue({
      pack: 'nist',
      packVersion: 1,
      controlsWithRule: 1,
      controlsTotal: 1,
      controls: [
        {
          controlId: 'AC-2',
          title: 't',
          family: 'AC',
          familyTitle: 'Access Control',
          state: ControlEvidence_State.HAS_EVIDENCE,
          eventCount: BigInt(4),
          lastEventTime: { seconds: BigInt(1_700_000_000), nanos: 0 },
        },
      ],
      events: [],
      nextPageToken: 'more',
    });
    const out = await daemonListControlCoverage({
      pack: 'nist',
      start: new Date('2026-08-01T00:00:00Z'),
      end: new Date('2026-11-01T00:00:00Z'),
    });
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList.mock.calls[0][0]).toMatchObject({ pack: 'nist', pageSize: 1, pageToken: '' });
    expect(out.controls[0]).toMatchObject({ controlId: 'AC-2', state: 'has_evidence', eventCount: 4 });
    expect(out.controls[0].lastEventTime).toBe('2023-11-14T22:13:20.000Z');
    expect('events' in out).toBe(false);
  });
});
