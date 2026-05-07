import 'server-only';

/**
 * Typed dashboard client methods for the mission-draft RPCs on
 * gibson.tenant.v1.TenantAdminService.
 *
 * Each wrapper calls userClient(TenantAdminService) so the call flows
 * dashboard → Envoy (JWT + SPIFFE mTLS) → daemon, never direct.
 *
 * Spec: mission-draft-dashboard-wiring.
 */

import { Code, ConnectError } from '@connectrpc/connect';
import { userClient } from '../gibson-client';
import { TenantAdminService } from '@/src/gen/gibson/tenant/v1/tenant_admin_pb';
import type {
  MissionDraft,
  MissionDraftFull,
} from '@/src/gen/gibson/tenant/v1/tenant_admin_pb';

export type { MissionDraft, MissionDraftFull };

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class MissionDraftNotFoundError extends Error {
  readonly code = 'not_found';
  constructor(message = 'Mission draft not found') {
    super(message);
    this.name = 'MissionDraftNotFoundError';
  }
}

/**
 * MissionDraftRpcError wraps any non-NotFound transport / daemon error from
 * the mission-draft RPCs. Callers catch this to render a generic toast
 * without exposing daemon internals.
 */
export class MissionDraftRpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MissionDraftRpcError';
    this.code = code;
  }
}

function mapErr(err: unknown): never {
  if (err instanceof ConnectError) {
    if (err.code === Code.NotFound) {
      throw new MissionDraftNotFoundError(err.rawMessage);
    }
    throw new MissionDraftRpcError(err.code.toString(), err.rawMessage);
  }
  const msg = err instanceof Error ? err.message : 'mission draft rpc failed';
  throw new MissionDraftRpcError('unknown', msg);
}

// ---------------------------------------------------------------------------
// RPC wrappers
// ---------------------------------------------------------------------------

export async function saveMissionDraft(
  tenantId: string,
  args: { name: string; yaml: string; draftId?: string },
): Promise<{ draftId: string }> {
  try {
    const client = userClient(TenantAdminService);
    const res = await client.saveMissionDraft({
      tenantId,
      name: args.name,
      yaml: args.yaml,
      draftId: args.draftId ?? '',
    });
    return { draftId: res.draftId };
  } catch (err) {
    mapErr(err);
  }
}

export async function listMissionDrafts(tenantId: string): Promise<MissionDraft[]> {
  try {
    const client = userClient(TenantAdminService);
    const res = await client.listMissionDrafts({ tenantId });
    return res.drafts;
  } catch (err) {
    mapErr(err);
  }
}

export async function getMissionDraft(
  tenantId: string,
  draftId: string,
): Promise<MissionDraftFull> {
  try {
    const client = userClient(TenantAdminService);
    const res = await client.getMissionDraft({ tenantId, draftId });
    if (!res.draft) {
      throw new MissionDraftNotFoundError();
    }
    return res.draft;
  } catch (err) {
    mapErr(err);
  }
}

export async function deleteMissionDraft(
  tenantId: string,
  draftId: string,
): Promise<void> {
  try {
    const client = userClient(TenantAdminService);
    await client.deleteMissionDraft({ tenantId, draftId });
  } catch (err) {
    mapErr(err);
  }
}
