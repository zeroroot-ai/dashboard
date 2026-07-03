/**
 * Unit tests for gibson-client/mission-source.ts error mapping.
 *
 * Mocks the underlying userClient so the tests run without a live gRPC
 * connection. Verifies that mapErr preserves typed errors:
 * - A gRPC NotFound status maps to MissionDraftNotFoundError.
 * - An empty `draft` in an OK getMissionDraft response surfaces as the
 *   typed MissionDraftNotFoundError, NOT a rewrapped generic
 *   MissionDraftRpcError (dashboard#957).
 * - Other transport errors map to MissionDraftRpcError.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';

// ---------------------------------------------------------------------------
// Mock server-only guard, vitest runs outside the Next.js runtime.
// ---------------------------------------------------------------------------
vi.mock('server-only', () => ({}));

// ---------------------------------------------------------------------------
// Mock userClient so no transport is created.
// ---------------------------------------------------------------------------
const mockTenantClient = {
  saveMissionDraft: vi.fn(),
  listMissionDrafts: vi.fn(),
  getMissionDraft: vi.fn(),
  deleteMissionDraft: vi.fn(),
};

vi.mock('@/src/lib/gibson-client', () => ({
  userClient: vi.fn(() => mockTenantClient),
}));

// Mock the proto service descriptor (not needed at runtime in tests).
vi.mock('@/src/gen/gibson/tenant/v1/tenant_pb', () => ({
  TenantService: {},
}));

// ---------------------------------------------------------------------------
// Subject under test, imported AFTER mocks.
// ---------------------------------------------------------------------------
import {
  getMissionDraft,
  listMissionDrafts,
  MissionDraftNotFoundError,
  MissionDraftRpcError,
} from '../mission-source';

describe('getMissionDraft error mapping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps a gRPC NotFound status to MissionDraftNotFoundError', async () => {
    mockTenantClient.getMissionDraft.mockRejectedValue(
      new ConnectError('draft gone', Code.NotFound),
    );

    await expect(getMissionDraft('t1', 'd1')).rejects.toBeInstanceOf(
      MissionDraftNotFoundError,
    );
  });

  it('surfaces an empty draft in an OK response as the typed MissionDraftNotFoundError, not a generic rpc error (dashboard#957)', async () => {
    // The daemon answered OK but with no draft payload; the wrapper throws
    // MissionDraftNotFoundError inside its own try block, and mapErr must
    // pass it through untouched.
    mockTenantClient.getMissionDraft.mockResolvedValue({ draft: undefined });

    const err = await getMissionDraft('t1', 'stale-draft').then(
      () => {
        throw new Error('expected getMissionDraft to reject');
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(MissionDraftNotFoundError);
    expect(err).not.toBeInstanceOf(MissionDraftRpcError);
    expect((err as MissionDraftNotFoundError).code).toBe('not_found');
  });

  it('maps other transport errors to MissionDraftRpcError', async () => {
    mockTenantClient.getMissionDraft.mockRejectedValue(
      new ConnectError('daemon unavailable', Code.Unavailable),
    );

    const err = await getMissionDraft('t1', 'd1').then(
      () => {
        throw new Error('expected getMissionDraft to reject');
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(MissionDraftRpcError);
  });
});

describe('listMissionDrafts error mapping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps non-ConnectError failures to MissionDraftRpcError(unknown)', async () => {
    mockTenantClient.listMissionDrafts.mockRejectedValue(
      new Error('socket hang up'),
    );

    const err = await listMissionDrafts('t1').then(
      () => {
        throw new Error('expected listMissionDrafts to reject');
      },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(MissionDraftRpcError);
    expect((err as MissionDraftRpcError).code).toBe('unknown');
  });
});
