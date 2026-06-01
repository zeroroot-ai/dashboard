import { ReactElement, type ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TenantContextProvider } from '@/src/lib/tenant-context';
import type { Tenant } from '@/src/types/tenant';

/**
 * Test utilities for rendering components with providers
 */

/**
 * Create a new QueryClient for each test to ensure isolation
 */
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

interface AllTheProvidersProps {
  children: React.ReactNode;
}

/**
 * Default stub tenant for hook tests. Matches the `tenantId: 'test-tenant'`
 * literal used by the MSW handlers and per-test fixture data.
 */
export const TEST_TENANT: Tenant = {
  id: 'test-tenant',
  name: 'test-tenant',
  displayName: 'Test Tenant',
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
};

/**
 * Wrap a render tree with QueryClient + TenantContext. The nine
 * tenant-scoped data hooks (useMissions, useFindings, useAlerts,
 * useAnalytics, useComponents, useTraces, useGraph, useWidgetLayout,
 * useMissionCreation) call `useTenantStore` which transitively requires
 * `TenantContextProvider`. Omitting it throws
 * "useTenantContext must be used within a TenantContextProvider."
 */
export function createHookWrapper(queryClient: QueryClient, tenant: Tenant | null = TEST_TENANT) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <TenantContextProvider
          currentTenant={tenant}
          availableTenants={tenant ? [tenant] : []}
          crossTenant={false}
          rolesByTenant={tenant ? { [tenant.id]: 'admin' } : {}}
          groups={[]}
        >
          {children}
        </TenantContextProvider>
      </QueryClientProvider>
    );
  };
}

/**
 * Wrapper component with all necessary providers for testing
 */
export function AllTheProviders({ children }: AllTheProvidersProps) {
  const queryClient = createTestQueryClient();
  const Wrapper = createHookWrapper(queryClient);
  return <Wrapper>{children}</Wrapper>;
}

/**
 * Custom render function that includes all providers
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  return render(ui, { wrapper: AllTheProviders, ...options });
}

/**
 * Custom render function with a specific QueryClient
 */
export function renderWithQueryClient(
  ui: ReactElement,
  queryClient: QueryClient,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );

  return render(ui, { wrapper: Wrapper, ...options });
}

// Re-export everything from React Testing Library
export * from '@testing-library/react';
export { default as userEvent } from '@testing-library/user-event';
