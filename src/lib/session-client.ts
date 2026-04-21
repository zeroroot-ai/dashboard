"use client";

/**
 * Client-side session shim.
 *
 * Wraps next-auth/react's useSession() so that all dashboard Client Components
 * continue to use the same import path (@/src/lib/session-client) without
 * knowing which auth backend is in use.
 *
 * Returned shape mirrors the previous Better Auth useSession() result so
 * callsites only need this one-line import — no other changes needed.
 */

import { useSession as useNextAuthSession } from "next-auth/react";

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: string | null;
  /**
   * Active tenant slug from the `gibson:tenant` OIDC claim injected by the
   * Zitadel custom claim Action (task 2).  Set after login and updated on
   * every token refresh triggered by switchTenantAction.
   */
  tenant?: string | null;
  /**
   * All tenant slugs available to this user, from the `gibson:tenants` claim.
   * May be absent for single-tenant users (only `tenant` will be set).
   */
  tenants?: string[];
};

export type ClientSession = {
  user: SessionUser;
  session: {
    id: string;
    userId: string;
    activeOrganizationId?: string | null;
    activeTeamId?: string | null;
    expiresAt?: string | Date;
  };
};

export type UseSessionResult = {
  data: ClientSession | null;
  isPending: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

export function useSession(): UseSessionResult {
  const { data, status, update } = useNextAuthSession();

  // Auth.js extends Session.user with the gibson:tenant claim (see auth.ts
  // module augmentation). Cast to access the extended fields safely.
  type ExtUser = {
    id?: string | null;
    email?: string | null;
    name?: string | null;
    image?: string | null;
    tenant?: string | null;
    tenants?: string[];
  };
  const extUser: ExtUser | undefined = data?.user
    ? (data.user as ExtUser)
    : undefined;

  const clientSession: ClientSession | null = extUser
    ? {
        user: {
          id: extUser.id ?? "",
          email: extUser.email ?? "",
          name: extUser.name ?? null,
          image: extUser.image ?? null,
          tenant: extUser.tenant ?? null,
          tenants: extUser.tenants,
        },
        session: {
          id: "",
          userId: extUser.id ?? "",
          expiresAt: data?.expires,
        },
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
