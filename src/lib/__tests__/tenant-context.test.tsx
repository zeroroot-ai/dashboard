// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import * as React from 'react';

import {
  TenantContextProvider,
  useTenantContext,
} from '@/src/lib/tenant-context';
import type { Tenant } from '@/src/types/tenant';

// ---------------------------------------------------------------------------
// Mocks: router refresh + the switch Server Action used by switchTenant
// ---------------------------------------------------------------------------

const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: mockRefresh,
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTenant(slug: string, displayName?: string): Tenant {
  return {
    id: slug,
    name: slug,
    displayName: displayName ?? slug,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

interface ProbeResult {
  currentTenantId: string | null;
  availableSlugs: string[];
  crossTenant: boolean;
  rolesByTenant: Record<string, string>;
  groups: string[];
  isLoading: boolean;
  canSwitchActive: boolean;
  canSwitchOther: boolean;
  switchTenant: (id: string) => Promise<void>;
}

const probe: { result?: ProbeResult } = {};

function Probe() {
  const ctx = useTenantContext();
  probe.result = {
    currentTenantId: ctx.currentTenant?.id ?? null,
    availableSlugs: ctx.availableTenants.map((t) => t.id),
    crossTenant: ctx.crossTenant,
    rolesByTenant: ctx.rolesByTenant,
    groups: ctx.groups,
    isLoading: ctx.isLoading,
    canSwitchActive: ctx.currentTenant
      ? ctx.canSwitchTenant(ctx.currentTenant.id)
      : false,
    canSwitchOther: ctx.canSwitchTenant(
      ctx.availableTenants.find((t) => t.id !== ctx.currentTenant?.id)?.id ??
        '__noop__',
    ),
    switchTenant: ctx.switchTenant,
  };
  return null;
}

function renderWithCtx(props: {
  currentTenant: Tenant | null;
  availableTenants: Tenant[];
  crossTenant?: boolean;
  rolesByTenant?: Record<string, string>;
  groups?: string[];
}) {
  return render(
    <TenantContextProvider
      currentTenant={props.currentTenant}
      availableTenants={props.availableTenants}
      crossTenant={props.crossTenant ?? false}
      rolesByTenant={props.rolesByTenant ?? {}}
      groups={props.groups ?? []}
    >
      <Probe />
    </TenantContextProvider>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TenantContextProvider', () => {
  it('surfaces server-supplied props on first render', () => {
    const acme = makeTenant('acme', 'Acme');
    const beta = makeTenant('beta', 'Beta');

    renderWithCtx({
      currentTenant: acme,
      availableTenants: [acme, beta],
      crossTenant: true,
      rolesByTenant: { acme: 'admin', beta: 'member' },
      groups: ['platform-ops'],
    });

    expect(probe.result).toMatchObject({
      currentTenantId: 'acme',
      availableSlugs: ['acme', 'beta'],
      crossTenant: true,
      rolesByTenant: { acme: 'admin', beta: 'member' },
      groups: ['platform-ops'],
      isLoading: false,
    });
  });

  it('canSwitchTenant is false for the active tenant, true for any other member tenant', () => {
    const acme = makeTenant('acme');
    const beta = makeTenant('beta');

    renderWithCtx({
      currentTenant: acme,
      availableTenants: [acme, beta],
    });

    expect(probe.result?.canSwitchActive).toBe(false);
    expect(probe.result?.canSwitchOther).toBe(true);
  });

  it('canSwitchTenant is false for an unknown slug', () => {
    const acme = makeTenant('acme');
    renderWithCtx({
      currentTenant: acme,
      availableTenants: [acme],
    });

    // probe.canSwitchOther uses the placeholder "__noop__" because there is
    // no second tenant, that exercises the unknown-slug branch.
    expect(probe.result?.canSwitchOther).toBe(false);
  });

  // ADR-0093 decision 4: a person has exactly one tenant, resolved
  // server-side from their identity. There is no UI that offers a switch,
  // and switchTenant always throws so a stray caller fails loud rather than
  // silently no-op.
  it('switchTenant always throws: tenant switching is not supported', async () => {
    mockRefresh.mockClear();

    const acme = makeTenant('acme');
    const beta = makeTenant('beta');
    renderWithCtx({
      currentTenant: acme,
      availableTenants: [acme, beta],
    });

    await act(async () => {
      await expect(probe.result!.switchTenant('beta')).rejects.toThrow(
        /not supported/i,
      );
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('throws a clear error when useTenantContext is used outside the provider', () => {
    // Suppress the React error-boundary log so the test output is clean.
    const originalError = console.error;
    console.error = vi.fn();
    try {
      expect(() => render(<Probe />)).toThrow(
        /useTenantContext must be used within a TenantContextProvider/,
      );
    } finally {
      console.error = originalError;
    }
  });
});
