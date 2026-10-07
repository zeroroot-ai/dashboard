// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import 'server-only';
/**
 * Typed dashboard client for gibson.tenant.v1.TenantService.ListAuditEvents
 * (lane 11 row G23, gibson#583).
 *
 * Each record names the actor (actor_id), the kind of actor (actor_source:
 * "user", "agent" or "system") and the object that the action changed
 * (target_object, "<type>:<id>"). The RPC carries the "admin" relation on
 * the tenant. The call goes through the user-acting transport (userClient).
 */
import { TenantService } from '@/src/gen/gibson/tenant/v1/tenant_pb';

import { userClient } from '../gibson-client';

interface AuditRecordDTO {
  eventType: string;
  /** RFC 3339 time of the record. */
  timestamp: string;
  actorId: string;
  actorEmail: string;
  /** "user", "agent" or "system". */
  actorSource: string;
  /** "<type>:<id>", or "<type>" when the action has no single object. */
  targetObject: string;
  traceId: string;
}

export interface AuditPageDTO {
  records: AuditRecordDTO[];
  /** Empty when no page follows. */
  nextCursor: string;
}

/** The page size of one read. The daemon caps it at 500. */
const PAGE_SIZE = 100;

/** One page of the audit log of the caller's tenant. */
export async function daemonListAuditRecords(cursor: string): Promise<AuditPageDTO> {
  const resp = await userClient(TenantService).listAuditEvents({ limit: PAGE_SIZE, cursor });
  return {
    records: resp.events.map((e) => ({
      eventType: e.eventType,
      timestamp: e.timestamp,
      actorId: e.actorId,
      actorEmail: e.actorEmail,
      actorSource: e.actorSource,
      targetObject: e.targetObject,
      traceId: e.traceId,
    })),
    nextCursor: resp.nextCursor,
  };
}
