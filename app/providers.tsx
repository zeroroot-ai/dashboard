'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/src/lib/query-client';

/**
 * GibsonProviders wraps the application with Gibson-specific context providers.
 *
 * Better Auth manages sessions via HTTP-only cookies and does not require a
 * React context provider. Client components access the session via
 * useSession() from '@/src/lib/auth-client'.
 *
 * Provider order (outermost to innermost):
 * 1. QueryClientProvider — React Query for tenant-scoped server state management
 */
export function GibsonProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
