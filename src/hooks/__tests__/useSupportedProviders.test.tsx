import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useSupportedProviders } from '../useSupportedProviders';
import { createTestQueryClient } from '@/src/test/test-utils';

// The hook fetches /api/settings/providers/supported (which the daemon
// services via gibson.tenant.v1.TenantService/GetSupportedProviders);
// the MSW handler returns `{ providers: [] }` in tests so the hook resolves
// with an empty array.

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSupportedProviders', () => {
  it('returns an empty list when the MSW handler reports zero providers', async () => {
    const { result } = renderHook(() => useSupportedProviders(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('never enters error state', async () => {
    const { result } = renderHook(() => useSupportedProviders(), { wrapper: wrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
  });
});
