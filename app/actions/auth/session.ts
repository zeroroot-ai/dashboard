import "server-only";

/**
 * getSession
 *
 * In-process replacement for the legacy client-side getSession() flow
 * (formerly via fetch('/api/auth/get-session')). Use from server
 * components and route
 * handlers; never imported into client components (the "server-only"
 * marker above will fail the build if anyone tries).
 */

import { headers } from "next/headers";

import { auth } from "@/src/lib/auth-server";

export async function getSession(): Promise<
  Awaited<ReturnType<typeof auth.api.getSession>> | null
> {
  try {
    return await auth.api.getSession({ headers: await headers() });
  } catch {
    return null;
  }
}
