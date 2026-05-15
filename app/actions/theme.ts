"use server";

import { cookies } from "next/headers";
import { auth } from "@/auth";
import {
  isThemeChoice,
  setThemeInZitadel,
  THEME_COOKIE_NAME,
  type ThemeChoice,
} from "@/src/lib/user-prefs/theme";

/**
 * Server Action — persist the user's theme preference.
 *
 *   - Always writes the `theme_choice` cookie (instant same-device effect
 *     and what app/layout.tsx reads for SSR).
 *   - If the user is authenticated, also writes Zitadel user metadata
 *     so the choice follows them to other devices on next sign-in.
 *
 * Returns whether the Zitadel sync succeeded so the UI can optionally
 * surface a "saved on this device only" hint on failure. Public callers
 * (signed-out theme picks on the marketing surface) just get the
 * cookie; the metadata path is skipped.
 */
export async function setThemePreference(
  theme: string,
): Promise<{ synced: boolean }> {
  if (!isThemeChoice(theme)) {
    throw new Error(`Invalid theme: ${theme}`);
  }
  const themeValue: ThemeChoice = theme;

  const cookieStore = await cookies();
  cookieStore.set({
    name: THEME_COOKIE_NAME,
    value: themeValue,
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  const session = await auth();
  if (!session?.user?.id) {
    return { synced: false };
  }
  const ok = await setThemeInZitadel(session.user.id, themeValue);
  return { synced: ok };
}
