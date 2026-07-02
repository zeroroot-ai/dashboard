import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';

import { TenantContextProvider } from '@/src/lib/tenant-context';
import {
  useTenantId,
  useAvailableTenants,
  useHasMultipleTenants,
  useIsCrossTenant,
  useGroups,
} from '@/src/lib/auth/tenant';
import type { Tenant } from '@/src/types/tenant';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

vi.mock('@/components/gibson/shared/tenant-switcher-action', () => ({
  switchActiveTenantAction: vi.fn(),
}));

function makeTenant(slug: string): Tenant {
  return {
    id: slug,
    name: slug,
    displayName: slug,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

interface ProbeResult {
  tenantId: string | null;
  available: string[];
  hasMultiple: boolean;
  isCross: boolean;
  groups: string[];
}

const probe: { result?: ProbeResult } = {};

function Probe() {
  probe.result = {
    tenantId: useTenantId(),
    available: useAvailableTenants(),
    hasMultiple: useHasMultipleTenants(),
    isCross: useIsCrossTenant(),
    groups: useGroups(),
  };
  return null;
}

function renderWith(props: {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
  crossTenant?: boolean;
  groups?: string[];
}) {
  return render(
    <TenantContextProvider
      currentTenant={props.currentTenant}
      availableTenants={props.availableTenants}
      crossTenant={props.crossTenant ?? false}
      rolesByTenant={{}}
      groups={props.groups ?? []}
    >
      <Probe />
    </TenantContextProvider>,
  );
}

describe('client authz hooks (src/lib/auth/tenant.ts)', () => {
  it('useTenantId reflects the active tenant', () => {
    const acme = makeTenant('acme');
    renderWith({ currentTenant: acme, availableTenants: [acme] });
    expect(probe.result?.tenantId).toBe('acme');
  });

  it('useAvailableTenants returns slugs in order', () => {
    const a = makeTenant('a');
    const b = makeTenant('b');
    const c = makeTenant('c');
    renderWith({ currentTenant: a, availableTenants: [a, b, c] });

    expect(probe.result?.available).toEqual(['a', 'b', 'c']);
    expect(probe.result?.hasMultiple).toBe(true);
  });

  it('useHasMultipleTenants is false for single-tenant users', () => {
    const acme = makeTenant('acme');
    renderWith({ currentTenant: acme, availableTenants: [acme] });
    expect(probe.result?.hasMultiple).toBe(false);
  });

  it('useTenantId is null when no active tenant is set', () => {
    renderWith({ currentTenant: null, availableTenants: [] });
    expect(probe.result?.tenantId).toBeNull();
    expect(probe.result?.available).toEqual([]);
  });

  it('useIsCrossTenant + useGroups reflect their context fields', () => {
    const acme = makeTenant('acme');
    renderWith({
      currentTenant: acme,
      availableTenants: [acme],
      crossTenant: true,
      groups: ['platform-ops', 'security-eng'],
    });

    expect(probe.result?.isCross).toBe(true);
    expect(probe.result?.groups).toEqual(['platform-ops', 'security-eng']);
  });
});
