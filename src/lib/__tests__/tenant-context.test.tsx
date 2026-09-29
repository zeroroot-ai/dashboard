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
