"use server";

/**
 * getSessionClient
 *
 * Server Action wrapper around the server-only getSession() helper. Used
 * by the client-side useSession() shim in src/lib/session-client.ts so
 * client components can read session state without a public HTTP call.
 * Server Actions are still RPC over POST, but they're scoped to the
 * Next.js app's own origin (CSRF + Origin enforced by the framework).
 */

import { getSession } from "@/app/actions/auth/session";

export async function getSessionClient() {
  return await getSession();
}
