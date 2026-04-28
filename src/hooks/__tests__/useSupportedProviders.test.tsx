import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { useSupportedProviders } from '../useSupportedProviders';
import { createTestQueryClient } from '@/src/test/test-utils';

// GetSupportedProviders RPC was deleted in admin-services-completion spec.
// The hook now returns an empty list as a static no-op.

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useSupportedProviders', () => {
  it('returns an empty list (GetSupportedProviders RPC deleted)', async () => {
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
