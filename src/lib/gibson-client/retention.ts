// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import 'server-only';
/**
 * Typed dashboard client for the retention period of the tenant:
 * TenantService.GetAuditRetention and SetAuditRetention (gibson#676).
 *
 * One period covers the audit log and the Timeline history (ADR-0163
 * decision 4, gibson#992). Postgres keeps both for the period, then only the
 * durable bucket holds them. The period is the longer of the install period
 * and the tenant period, and never under 13 months. Both RPCs carry the
 * "admin" relation on the tenant and go through the user-acting transport.
 */
import { userClient } from '../gibson-client';
import { TenantService, type AuditRetention } from '@/src/gen/gibson/tenant/v1/tenant_pb';

export interface RetentionDTO {
  /** The period the tenant set, in months. 0 means none. */
  tenantMonths: number;
  /** The period of the install, in months. */
  installMonths: number;
  /** The period that applies, in months. */
  effectiveMonths: number;
}

function toDTO(r: AuditRetention | undefined): RetentionDTO {
  return {
    tenantMonths: r?.tenantMonths ?? 0,
    installMonths: r?.installMonths ?? 0,
    effectiveMonths: r?.effectiveMonths ?? 0,
  };
}

export async function daemonGetRetention(): Promise<RetentionDTO> {
  const res = await userClient(TenantService).getAuditRetention({});
  return toDTO(res.retention);
}

/** Set the tenant period. 0 removes it, and the tenant uses the install period. */
export async function daemonSetRetention(months: number): Promise<RetentionDTO> {
  const res = await userClient(TenantService).setAuditRetention({ months });
  return toDTO(res.retention);
}
