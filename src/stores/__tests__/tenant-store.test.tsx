// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import * as React from 'react';

import { TenantContextProvider } from '@/src/lib/tenant-context';
import {
  useTenantStore,
  useCurrentTenant,
  useAvailableTenants,
  useTenantLoading,
  useTenantError,
} from '@/src/stores/tenant-store';
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
  storeCurrent: Tenant | null;
  storeAvailable: Tenant[];
  storeLoading: boolean;
  storeError: null;
  named: {
    current: Tenant | null;
    available: Tenant[];
    loading: boolean;
    error: null;
  };
}

const probe: { result?: ProbeResult } = {};

function Probe() {
  const storeCurrent = useTenantStore((s) => s.currentTenant);
  const storeAvailable = useTenantStore((s) => s.availableTenants);
  const storeLoading = useTenantStore((s) => s.isLoading);
  const storeError = useTenantStore((s) => s.error);

  probe.result = {
    storeCurrent,
    storeAvailable,
    storeLoading,
    storeError,
    named: {
      current: useCurrentTenant(),
      available: useAvailableTenants(),
      loading: useTenantLoading(),
      error: useTenantError(),
    },
  };
  return null;
}

function renderProbe(props: {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
}) {
  return render(
    <TenantContextProvider
      currentTenant={props.currentTenant}
      availableTenants={props.availableTenants}
      crossTenant={false}
      rolesByTenant={{}}
      groups={[]}
    >
      <Probe />
    </TenantContextProvider>,
  );
}

describe('tenant-store shim', () => {
  it('useTenantStore selectors mirror the React context', () => {
    const acme = makeTenant('acme');
    const beta = makeTenant('beta');

    renderProbe({
      currentTenant: acme,
      availableTenants: [acme, beta],
    });

    expect(probe.result?.storeCurrent).toEqual(acme);
    expect(probe.result?.storeAvailable).toEqual([acme, beta]);
    expect(probe.result?.storeLoading).toBe(false);
    expect(probe.result?.storeError).toBeNull();
  });

  it('named selector hooks return matching values', () => {
    const acme = makeTenant('acme');
    renderProbe({
      currentTenant: acme,
      availableTenants: [acme],
    });

    expect(probe.result?.named.current).toEqual(acme);
    expect(probe.result?.named.available).toEqual([acme]);
    expect(probe.result?.named.loading).toBe(false);
    expect(probe.result?.named.error).toBeNull();
  });


  it('returns null currentTenant + empty availableTenants when context is empty', () => {
    renderProbe({
      currentTenant: null,
      availableTenants: [],
    });

    expect(probe.result?.storeCurrent).toBeNull();
    expect(probe.result?.storeAvailable).toEqual([]);
  });
});
