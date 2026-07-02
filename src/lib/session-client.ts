"use client";

/**
 * Client-side session shim.
 *
 * Wraps next-auth/react's useSession() so dashboard Client Components have a
 * stable import path independent of the auth backend.
 *
 * IMPORTANT: this hook only exposes the fields the Auth.js session callback
 * actually emits (`auth.ts` `session` callback): `id`, `email`, `name`,
 * `image`. Tenant / membership / permission / role state lives elsewhere:
 *
 *   - Server-side reads use `getServerSession()` from `@/src/lib/auth`,
 *     which re-resolves tenant + role + permission state from the
 *     `gibson_active_tenant` cookie + FGA on every request.
 *   - Client-side reads use the React context surfaced via
 *     `TenantContextProvider` (mounted in the auth layout). Hooks:
 *     `useTenant`, `useTenantId`, `useIsCrossTenant`, etc. Authorization
 *     gating uses `useAuthorize('/gibson...Method')` against the AuthRegistry.
 *
 * Reading `session.user.tenant` / `tenants` / `permissions` / `crossTenant`
 * here is a bug, the auth callback does not put those fields on the
 * encrypted JWT cookie that drives `useSession`. Use the context instead.
 */

import { useSession as useNextAuthSession } from "next-auth/react";

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
};

type ClientSession = {
  user: SessionUser;
  expiresAt?: string | Date;
};

type UseSessionResult = {
  data: ClientSession | null;
  isPending: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

export function useSession(): UseSessionResult {
  const { data, status, update } = useNextAuthSession();

  const clientSession: ClientSession | null = data?.user
    ? {
        user: {
          id: data.user.id ?? "",
          email: data.user.email ?? "",
          name: data.user.name ?? null,
          image: data.user.image ?? null,
        },
        expiresAt: data.expires,
      }
    : null;

  const refetch = async () => {
    await update();
  };

  return {
    data: clientSession,
    isPending: status === "loading",
    error: null,
    refetch,
  };
}
