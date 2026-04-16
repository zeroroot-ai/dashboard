import { QueryClient } from "@tanstack/react-query";

/**
 * React Query client configuration for Gibson Mission Control dashboard.
 *
 * Configuration follows design document specifications:
 * - staleTime: 30 seconds - data considered fresh for 30s before refetch
 * - gcTime: 5 minutes - cache retained for 5 min after last usage
 * - retry: 3 attempts with exponential backoff
 * - refetchOnWindowFocus: true - refresh data when user returns to window
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh for 30 seconds
      staleTime: 30 * 1000,

      // Garbage collection time: cache retained for 5 minutes
      gcTime: 5 * 60 * 1000,

      // Retry failed requests 3 times with exponential backoff
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),

      // Refetch when window regains focus
      refetchOnWindowFocus: true,

      // Don't refetch on reconnect (SSE handles real-time updates)
      refetchOnReconnect: false,

      // Don't refetch on mount if data is fresh
      refetchOnMount: false,
    },
    mutations: {
      // Retry mutations once
      retry: 1,
      retryDelay: 1000,
    },
  },
});

/**
 * Creates a new QueryClient instance with default configuration.
 * Useful for testing or creating isolated query client instances.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        retry: 3,
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
        refetchOnWindowFocus: true,
        refetchOnReconnect: false,
        refetchOnMount: false,
      },
      mutations: {
        retry: 1,
        retryDelay: 1000,
      },
    },
  });
}
