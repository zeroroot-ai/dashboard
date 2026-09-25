// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Resolves the signed-in person's tenant at sign-in time (ADR-0093 decision
 * 4). ext-authz derives the tenant from the token's verified Zitadel org;
 * this module asks the daemon (through ext-authz) which tenant that
 * resolved to, via `DaemonService.ListMyMemberships`, and stamps it onto
 * the JWT cookie in `auth.ts`'s `jwt` callback.
 *
 * There is no client-asserted tenant. A client-supplied value is never
 * consulted here or anywhere downstream (see `auth.ts`'s `jwt` callback,
 * `trigger: "update"` branch).
 *
 * @module auth/session-tenant
 */

import 'server-only';

import type { JWT } from 'next-auth/jwt';

import { DaemonService } from '@/src/gen/gibson/daemon/v1/daemon_pb';
import { tokenClient } from '@/src/lib/gibson-client/transport';
import { logger } from '@/src/lib/logger';

/**
 * Thrown when the daemon reports more than one membership for the caller.
 * A person has exactly one tenant (ADR-0093 decision 4); more than one
 * membership means the one-tenant invariant broke upstream, and sign-in
 * must fail rather than silently pick one.
 */
export class TenantInvariantError extends Error {
  constructor(count: number) {
    super(`ListMyMemberships returned ${count} memberships, want 0 or 1`);
    this.name = 'TenantInvariantError';
  }
}

/**
 * Asks the daemon which tenant the caller's token resolved to.
 *
 * @returns the tenant id, or `null` when the caller has none (the Platform
 *   owner, or a tenant still provisioning).
 * @throws {TenantInvariantError} when the daemon returns more than one
 *   membership.
 * @throws whatever the transport throws on a genuine transport/daemon
 *   failure — this function never swallows an error into a guessed tenant.
 */
export async function resolveTenantForToken(
  accessToken: string,
): Promise<string | null> {
  const client = tokenClient(DaemonService, accessToken);
  const resp = await client.listMyMemberships({});
  const memberships = resp.memberships ?? [];
  if (memberships.length === 0) return null;
  if (memberships.length > 1) {
    throw new TenantInvariantError(memberships.length);
  }
  return memberships[0]!.tenantId || null;
}

/**
 * Resolves the tenant for `accessToken` and stamps `token.tenantId` +
 * `token.tenantResolvedAt`. Called from the `jwt` callback in `auth.ts`,
 * both at initial sign-in and on an explicit `trigger: "update"` re-run
 * (e.g. after onboarding finishes provisioning a tenant).
 *
 * A transport error, or a `TenantInvariantError`, is intentionally NOT
 * caught here: the caller (the `jwt` callback) must let it propagate so
 * sign-in fails closed rather than store a guess. Logging happens here so
 * the failure is visible even though the error itself propagates.
 */
export async function stampSessionTenant(
  token: JWT,
  accessToken: string,
): Promise<void> {
  try {
    const tenantId = await resolveTenantForToken(accessToken);
    token.tenantId = tenantId;
    token.tenantResolvedAt = Math.floor(Date.now() / 1000);
  } catch (err) {
    logger.error(
      { err, scope: 'auth.session_tenant' },
      'tenant resolution failed at sign-in',
    );
    throw err;
  }
}
