'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { SessionProvider } from 'next-auth/react';
import { queryClient } from '@/src/lib/query-client';

/**
 * GibsonProviders wraps the application with Gibson-specific context providers.
 *
 * Auth.js v5 (next-auth) requires SessionProvider to be mounted at (or above)
 * any Client Component that calls useSession(). Without it, useSession()
 * returns undefined and every consumer crashes with "Cannot destructure
 * property 'data' of '(0 , t.useSession)(...)' as it is undefined", taking
 * down the whole dashboard with a client-side exception.
 *
 * The historical pre-Auth.js wiring did NOT need a provider (HTTP cookies
 * only, no React context), and the SessionProvider import was dropped during
 * that era. The Auth.js v5 migration re-adds it here.
 *
 * Provider order (outermost to innermost):
 * 1. SessionProvider    , Auth.js v5 client-side session context
 * 2. QueryClientProvider, React Query for tenant-scoped server state
 */
export function GibsonProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </SessionProvider>
  );
}
