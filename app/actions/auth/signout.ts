"use server";

/**
 * signOutAction
 *
 * Server Action replacing POST /api/auth/sign-out. Invalidates the
 * Better Auth session and clears the cookie via the nextCookies plugin,
 * then redirects to /login.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/src/lib/auth-server";

export async function signOutAction(redirectTo?: string): Promise<never> {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // Even if Better Auth says no session existed, fall through to the
    // redirect — the user clearly wants to land on a logged-out page.
  }
  // Allow callers to pin a specific landing page; default to /login.
  // We restrict to same-origin paths to prevent open-redirect abuse.
  const target = redirectTo && redirectTo.startsWith("/") ? redirectTo : "/login";
  redirect(target);
}
