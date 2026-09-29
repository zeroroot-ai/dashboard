// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';

import { TenantContextProvider } from '@/src/lib/tenant-context';
import {
  useTenantId,
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
  isCross: boolean;
  groups: string[];
}

const probe: { result?: ProbeResult } = {};

function Probe() {
  probe.result = {
    tenantId: useTenantId(),
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



  it('useTenantId is null when no active tenant is set', () => {
    renderWith({ currentTenant: null, availableTenants: [] });
    expect(probe.result?.tenantId).toBeNull();
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
