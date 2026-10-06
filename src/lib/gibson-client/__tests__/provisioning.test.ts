// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * @vitest-environment node
 *
 * Unit tests for gibson-client/provisioning.ts (dashboard#1016).
 *
 * The redacted field stays OFF `getTenantProvisioningStatus`. That RPC is
 * proto-annotated `unauthenticated: true`, so ext-authz never resolves a
 * tenant for it and the daemon's same-tenant unredaction branch can never be
 * taken. The mapper must therefore drop `zitadel_org_slug` unconditionally,
 * even when the daemon does send it. The daemon is the real gate; the
 * dashboard must not re-widen it.
 *
 * The dashboard reads no billing identifier at all (dashboard#226).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockGetTenantProvisioningStatus = vi.fn();

const serviceClientCalls: unknown[][] = [];

vi.mock('../transport', () => ({
  serviceClient: (...args: unknown[]) => {
    serviceClientCalls.push(args);
    return {
      getTenantProvisioningStatus: mockGetTenantProvisioningStatus,
    };
  },
}));

import * as provisioning from '../provisioning';
import { getTenantProvisioningStatus } from '../provisioning';

/**
 * A wire response the daemon would only ever produce for an authenticated
 * same-tenant caller. `getTenantProvisioningStatus` can never BE such a
 * caller, so if these values ever reach a dashboard consumer the mapper is
 * the thing that leaked them.
 */
const WIRE_RESPONSE_WITH_REDACTED_FIELDS = {
  found: true,
  phase: 'Provisioning',
  dataPlaneReady: true,
  stores: { postgres: 'ready', redis: 'ready', neo4j: 'provisioning' },
  zitadelOrgReady: true,
  zitadelOrgSlug: 'acme-org',
};

/** Every string/boolean leaf reachable from `value`. */
function leaves(value: unknown): unknown[] {
  if (value === null || typeof value !== 'object') return [value];
  return Object.values(value as Record<string, unknown>).flatMap(leaves);
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceClientCalls.length = 0;
});

describe('getTenantProvisioningStatus', () => {
  it('maps the non-redacted fields the onboarding + signup pollers read', async () => {
    mockGetTenantProvisioningStatus.mockResolvedValue(
      WIRE_RESPONSE_WITH_REDACTED_FIELDS,
    );

    const result = await getTenantProvisioningStatus('acme');

    expect(mockGetTenantProvisioningStatus).toHaveBeenCalledWith({ tenantId: 'acme' });
    expect(result).toEqual({
      found: true,
      phase: 'Provisioning',
      dataPlaneReady: true,
      stores: { postgres: 'ready', redis: 'ready', neo4j: 'provisioning' },
      zitadelOrgReady: true,
    });
  });

  it('defaults absent per-store states to empty strings', async () => {
    mockGetTenantProvisioningStatus.mockResolvedValue({
      found: false,
      phase: '',
      dataPlaneReady: false,
      stores: undefined,
      zitadelOrgReady: false,
    });

    const result = await getTenantProvisioningStatus('nope');

    expect(result.found).toBe(false);
    expect(result.stores).toEqual({ postgres: '', redis: '', neo4j: '' });
  });

  // ---- the leak-stays-shut half ------------------------------------------
  it('drops zitadel_org_slug even when the daemon sends it', async () => {
    mockGetTenantProvisioningStatus.mockResolvedValue(
      WIRE_RESPONSE_WITH_REDACTED_FIELDS,
    );

    const result = await getTenantProvisioningStatus('acme');

    expect(result).not.toHaveProperty('zitadelOrgSlug');
  });

  it('surfaces no redacted VALUE anywhere in the mapped result', async () => {
    mockGetTenantProvisioningStatus.mockResolvedValue(
      WIRE_RESPONSE_WITH_REDACTED_FIELDS,
    );

    const result = await getTenantProvisioningStatus('acme');

    // Structural scan: a renamed or nested re-export leaks just as badly as
    // the original field name, so assert on the values, not only the keys.
    const values = leaves(result);
    expect(values).not.toContain('acme-org');
    expect(JSON.stringify(result)).not.toContain('acme-org');
  });

  it('reads over the unauthenticated service-acting transport (empty tenant)', async () => {
    mockGetTenantProvisioningStatus.mockResolvedValue(
      WIRE_RESPONSE_WITH_REDACTED_FIELDS,
    );

    await getTenantProvisioningStatus('acme');

    expect(serviceClientCalls).toHaveLength(1);
    expect(serviceClientCalls[0][1]).toBe('');
  });
});

describe('no billing reader', () => {
  // dashboard#226: the dashboard holds no billing code. gibson#895 removed the
  // billing RPCs, and nothing here may wrap one.
  it('exports no billing helper', () => {
    const exported = Object.keys(provisioning);
    expect(exported.filter((n) => /billing/i.test(n))).toEqual([]);
  });
});
