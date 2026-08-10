/**
 * @vitest-environment node
 *
 * Unit tests for gibson-client/provisioning.ts (dashboard#1016).
 *
 * Two halves, both required:
 *
 * 1. The billing identifiers stay REACHABLE through the rule-mode RPCs —
 *    `TenantService.GetTenantBilling` (own tenant, `tenant_from_identity`) and
 *    `AdminTenantService.AdminGetTenantBilling` (`platform_operator` on
 *    `system_tenant`). Both go over `userClient`, so ext-authz resolves and
 *    authorizes the caller before the daemon handler runs.
 *
 * 2. The redacted fields stay OFF `getTenantProvisioningStatus`. That RPC is
 *    proto-annotated `unauthenticated: true`, so ext-authz never resolves a
 *    tenant for it and the daemon's same-tenant unredaction branch can never
 *    be taken. The mapper must therefore drop `zitadel_org_slug` /
 *    `stripe_customer_id` / `billing_active` unconditionally — even when the
 *    daemon does send them. The daemon is the real gate; the dashboard must
 *    not re-widen it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockGetTenantProvisioningStatus = vi.fn();
const mockSetTenantBillingActive = vi.fn();
const mockGetTenantBilling = vi.fn();
const mockAdminGetTenantBilling = vi.fn();

const serviceClientCalls: unknown[][] = [];
const userClientCalls: unknown[][] = [];

vi.mock('../transport', () => ({
  serviceClient: (...args: unknown[]) => {
    serviceClientCalls.push(args);
    return {
      getTenantProvisioningStatus: mockGetTenantProvisioningStatus,
      setTenantBillingActive: mockSetTenantBillingActive,
    };
  },
  userClient: (...args: unknown[]) => {
    userClientCalls.push(args);
    return {
      getTenantBilling: mockGetTenantBilling,
      adminGetTenantBilling: mockAdminGetTenantBilling,
    };
  },
}));

import * as provisioning from '../provisioning';
import {
  getTenantProvisioningStatus,
  getTenantBilling,
  adminGetTenantBilling,
} from '../provisioning';
import { TenantService } from '@/src/gen/gibson/tenant/v1/tenant_pb';
import { AdminTenantService } from '@/src/gen/gibson/tenant/v1/admin_tenant_pb';

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
  stripeCustomerId: 'cus_LEAK',
  billingActive: true,
};

/** Every string/boolean leaf reachable from `value`. */
function leaves(value: unknown): unknown[] {
  if (value === null || typeof value !== 'object') return [value];
  return Object.values(value as Record<string, unknown>).flatMap(leaves);
}

beforeEach(() => {
  vi.clearAllMocks();
  serviceClientCalls.length = 0;
  userClientCalls.length = 0;
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
  it('drops zitadel_org_slug / stripe_customer_id / billing_active even when the daemon sends them', async () => {
    mockGetTenantProvisioningStatus.mockResolvedValue(
      WIRE_RESPONSE_WITH_REDACTED_FIELDS,
    );

    const result = await getTenantProvisioningStatus('acme');

    expect(result).not.toHaveProperty('zitadelOrgSlug');
    expect(result).not.toHaveProperty('stripeCustomerId');
    expect(result).not.toHaveProperty('billingActive');
  });

  it('surfaces no redacted VALUE anywhere in the mapped result', async () => {
    mockGetTenantProvisioningStatus.mockResolvedValue(
      WIRE_RESPONSE_WITH_REDACTED_FIELDS,
    );

    const result = await getTenantProvisioningStatus('acme');

    // Structural scan: a renamed or nested re-export leaks just as badly as
    // the original field name, so assert on the values, not only the keys.
    const values = leaves(result);
    expect(values).not.toContain('cus_LEAK');
    expect(values).not.toContain('acme-org');
    expect(JSON.stringify(result)).not.toContain('cus_LEAK');
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

describe('SetTenantBillingActive has no dashboard wrapper', () => {
  // dashboard#1016 ask 4. The dashboard serves no Stripe webhook route and
  // holds no GIBSON_BILLING_WEBHOOK_SECRET, so it cannot sign the HMAC
  // assertion the daemon now demands. Nothing here may call or re-export it.
  it('exports no billing-active writer', () => {
    const exported = Object.keys(provisioning);
    expect(exported).not.toContain('setTenantBillingActive');
    expect(exported.filter((n) => /billingactive/i.test(n))).toEqual([]);
  });

  it('never calls the SetTenantBillingActive RPC from any exported helper', async () => {
    mockGetTenantProvisioningStatus.mockResolvedValue(
      WIRE_RESPONSE_WITH_REDACTED_FIELDS,
    );
    mockGetTenantBilling.mockResolvedValue({
      found: true,
      stripeCustomerId: 'cus_real',
      billingActive: true,
      zitadelOrgSlug: 'acme-org',
    });
    mockAdminGetTenantBilling.mockResolvedValue({
      found: true,
      stripeCustomerId: 'cus_real',
      billingActive: true,
      zitadelOrgSlug: 'acme-org',
    });

    await getTenantProvisioningStatus('acme');
    await getTenantBilling();
    await adminGetTenantBilling('acme');

    expect(mockSetTenantBillingActive).not.toHaveBeenCalled();
  });
});

describe('getTenantBilling', () => {
  it('returns the real billing identifiers over the authenticated user transport', async () => {
    mockGetTenantBilling.mockResolvedValue({
      found: true,
      stripeCustomerId: 'cus_real',
      billingActive: true,
      zitadelOrgSlug: 'acme-org',
    });

    const result = await getTenantBilling();

    expect(userClientCalls).toEqual([[TenantService]]);
    expect(result).toEqual({
      found: true,
      stripeCustomerId: 'cus_real',
      billingActive: true,
      zitadelOrgSlug: 'acme-org',
    });
  });

  it('sends no tenant_id — the daemon derives it from the caller identity', async () => {
    mockGetTenantBilling.mockResolvedValue({
      found: true,
      stripeCustomerId: 'cus_real',
      billingActive: true,
      zitadelOrgSlug: 'acme-org',
    });

    await getTenantBilling();

    expect(mockGetTenantBilling).toHaveBeenCalledWith({});
  });
});

describe('adminGetTenantBilling', () => {
  it('forwards the target tenant and returns its billing identifiers', async () => {
    mockAdminGetTenantBilling.mockResolvedValue({
      found: true,
      stripeCustomerId: 'cus_other',
      billingActive: false,
      zitadelOrgSlug: 'other-org',
    });

    const result = await adminGetTenantBilling('other-tenant');

    expect(userClientCalls).toEqual([[AdminTenantService]]);
    expect(mockAdminGetTenantBilling).toHaveBeenCalledWith({ tenantId: 'other-tenant' });
    expect(result).toEqual({
      found: true,
      stripeCustomerId: 'cus_other',
      billingActive: false,
      zitadelOrgSlug: 'other-org',
    });
  });
});
