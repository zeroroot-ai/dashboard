"use client";

/**
 * Client-side session shim.
 *
 * Replaces the legacy client-side useSession() hook from
 * better-auth/react. Internally calls the in-process getSessionClient
 * Server Action (which calls auth.api.getSession server-side). No
 * public /api/auth/* HTTP endpoint exists any more; Next.js Server
 * Action RPC has its own Origin + CSRF protection.
 *
 * Returned shape mirrors the previous useSession() result so callsites
 * only need a one-line import swap.
 */

import { useEffect, useState } from "react";

import { getSessionClient } from "@/app/actions/auth/session-client";

export type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: string | null;
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
  const [data, setData] = useState<ClientSession | null>(null);
  const [isPending, setIsPending] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSession = async () => {
    setIsPending(true);
    try {
      const s = await getSessionClient();
      setData(s as ClientSession | null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)));
      setData(null);
    } finally {
      setIsPending(false);
    }
  };

  useEffect(() => {
    void fetchSession();
    // intentional: fetch once on mount; consumers call refetch() if needed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, isPending, error, refetch: fetchSession };
}
