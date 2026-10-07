// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import 'server-only';
/**
 * Typed dashboard client for the registration queue of
 * gibson.tenant.v1.AdminTenantService (ADR-0074, gibson#620, dashboard#193).
 *
 * A person who registers on the approval rung holds a deactivated account
 * until a Platform owner decides. These three calls read the queue and
 * record a decision. Each RPC carries the "platform_owner" relation on the
 * system tenant. The calls go through the user-acting transport
 * (userClient), never a direct channel, and ext-authz decides the relation.
 */
import { AdminTenantService } from '@/src/gen/gibson/tenant/v1/admin_tenant_pb';

import { userClient } from '../gibson-client';

export interface PendingRegistrationDTO {
  /** The id an approval or a rejection names. */
  registrationId: string;
  ownerEmail: string;
  workspaceName: string;
  /** The plan the person asked for, as typed. */
  tier: string;
  ownerFirstName: string;
  ownerLastName: string;
}

export interface ApprovedRegistrationDTO {
  tenantId: string;
  ownerUserId: string;
  planId: string;
}

/** The queue size that one read returns. The daemon caps it too. */
const QUEUE_LIMIT = 200;

/** The registrations that wait for a decision, oldest first. */
export async function daemonListPendingRegistrations(): Promise<PendingRegistrationDTO[]> {
  const resp = await userClient(AdminTenantService).adminListPendingRegistrations({
    limit: QUEUE_LIMIT,
  });
  return resp.registrations.map((r) => ({
    registrationId: r.registrationId,
    ownerEmail: r.ownerEmail,
    workspaceName: r.workspaceName,
    tier: r.tier,
    ownerFirstName: r.ownerFirstName,
    ownerLastName: r.ownerLastName,
  }));
}

/** Approve one registration: the account becomes active and the tenant is queued. */
export async function daemonApproveRegistration(
  registrationId: string,
): Promise<ApprovedRegistrationDTO> {
  const resp = await userClient(AdminTenantService).adminApproveRegistration({ registrationId });
  return { tenantId: resp.tenantId, ownerUserId: resp.ownerUserId, planId: resp.planId };
}

/** Reject one registration. The reason goes to the audit event only. */
export async function daemonRejectRegistration(
  registrationId: string,
  reason: string,
): Promise<void> {
  await userClient(AdminTenantService).adminRejectRegistration({ registrationId, reason });
}
