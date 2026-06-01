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
  useSwitcherOpen,
  useTenantActions,
  useCanSwitchToTenant,
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
  storeCurrent: Tenant | null;
  storeAvailable: Tenant[];
  storeLoading: boolean;
  storeError: null;
  storeSwitcherOpen: boolean;
  named: {
    current: Tenant | null;
    available: Tenant[];
    loading: boolean;
    error: null;
    switcherOpen: boolean;
    actions: ReturnType<typeof useTenantActions>;
  };
  canSwitchToActive: boolean;
  canSwitchToOther: boolean;
}

const probe: { result?: ProbeResult } = {};

function Probe({ otherSlug }: { otherSlug: string }) {
  const storeCurrent = useTenantStore((s) => s.currentTenant);
  const storeAvailable = useTenantStore((s) => s.availableTenants);
  const storeLoading = useTenantStore((s) => s.isLoading);
  const storeError = useTenantStore((s) => s.error);
  const storeSwitcherOpen = useTenantStore((s) => s.switcherOpen);

  probe.result = {
    storeCurrent,
    storeAvailable,
    storeLoading,
    storeError,
    storeSwitcherOpen,
    named: {
      current: useCurrentTenant(),
      available: useAvailableTenants(),
      loading: useTenantLoading(),
      error: useTenantError(),
      switcherOpen: useSwitcherOpen(),
      actions: useTenantActions(),
    },
    canSwitchToActive: useCanSwitchToTenant(storeCurrent?.id ?? '__none__'),
    canSwitchToOther: useCanSwitchToTenant(otherSlug),
  };
  return null;
}

function renderProbe(props: {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
  otherSlug: string;
}) {
  return render(
    <TenantContextProvider
      currentTenant={props.currentTenant}
      availableTenants={props.availableTenants}
      crossTenant={false}
      rolesByTenant={{}}
      groups={[]}
    >
      <Probe otherSlug={props.otherSlug} />
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
      otherSlug: 'beta',
    });

    expect(probe.result?.storeCurrent).toEqual(acme);
    expect(probe.result?.storeAvailable).toEqual([acme, beta]);
    expect(probe.result?.storeLoading).toBe(false);
    expect(probe.result?.storeError).toBeNull();
    expect(probe.result?.storeSwitcherOpen).toBe(false);
  });

  it('named selector hooks return matching values', () => {
    const acme = makeTenant('acme');
    renderProbe({
      currentTenant: acme,
      availableTenants: [acme],
      otherSlug: 'ghost',
    });

    expect(probe.result?.named.current).toEqual(acme);
    expect(probe.result?.named.available).toEqual([acme]);
    expect(probe.result?.named.loading).toBe(false);
    expect(probe.result?.named.error).toBeNull();
    expect(probe.result?.named.switcherOpen).toBe(false);

    // useTenantActions returns no-op functions; calling them is safe and
    // returns undefined.
    expect(probe.result?.named.actions.setCurrentTenant({})).toBeUndefined();
  });

  it('useCanSwitchToTenant: false for active, true for other member, false for unknown', () => {
    const acme = makeTenant('acme');
    const beta = makeTenant('beta');

    renderProbe({
      currentTenant: acme,
      availableTenants: [acme, beta],
      otherSlug: 'beta',
    });

    expect(probe.result?.canSwitchToActive).toBe(false);
    expect(probe.result?.canSwitchToOther).toBe(true);

    renderProbe({
      currentTenant: acme,
      availableTenants: [acme, beta],
      otherSlug: 'ghost',
    });
    expect(probe.result?.canSwitchToOther).toBe(false);
  });

  it('returns null currentTenant + empty availableTenants when context is empty', () => {
    renderProbe({
      currentTenant: null,
      availableTenants: [],
      otherSlug: 'whatever',
    });

    expect(probe.result?.storeCurrent).toBeNull();
    expect(probe.result?.storeAvailable).toEqual([]);
    expect(probe.result?.canSwitchToOther).toBe(false);
  });
});
