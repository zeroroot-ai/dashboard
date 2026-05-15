/**
 * Per-user theme preference — cookie-mirrored, Zitadel-canonical.
 *
 * The dashboard's other `theme_*` cookies are per-device. Per #57
 * sub-decision 2 the user-facing light/dark/system choice is per-user
 * and syncs across devices. Implemented via:
 *
 *   - Zitadel user metadata `theme_choice` is the source of truth.
 *   - The signed-in user's JWT signIn callback reads it once and writes
 *     a same-named cookie, so app/layout.tsx's server render picks up
 *     the correct theme without a per-request Zitadel call.
 *   - Server Action setThemePreference writes BOTH the cookie (instant
 *     same-device effect) and the metadata (cross-device sync).
 *
 * Zitadel reads/writes are best-effort: a 5xx or auth failure during a
 * pref read degrades to "never set" (the cookie wins); a write that
 * fails leaves the cookie in place so the user's intent isn't lost on
 * the current device.
 */

import { getSignupZitadelAdminClient } from "@/src/lib/zitadel/admin-client-factory";
import { logger } from "@/src/lib/logger";

export const THEME_METADATA_KEY = "theme_choice";
export const THEME_COOKIE_NAME = "theme_choice";

const VALID_THEMES = new Set(["light", "dark", "system"]);

export type ThemeChoice = "light" | "dark" | "system";

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return typeof value === "string" && VALID_THEMES.has(value);
}

/**
 * Fetch the user's theme preference from Zitadel. Returns null when never
 * set, when Zitadel is unreachable, or when the stored value is invalid.
 * Never throws.
 */
export async function getThemeFromZitadel(
  userId: string,
): Promise<ThemeChoice | null> {
  try {
    const client = getSignupZitadelAdminClient();
    const value = await client.getUserMetadata(userId, THEME_METADATA_KEY);
    if (value && isThemeChoice(value)) return value;
    return null;
  } catch (err) {
    logger.warn(
      { err: String(err), userId },
      "[user-prefs/theme] failed to read theme from Zitadel; degrading to cookie/default",
    );
    return null;
  }
}

/**
 * Persist the user's theme preference to Zitadel. Returns true on
 * success, false on failure (caller decides whether to surface).
 */
export async function setThemeInZitadel(
  userId: string,
  theme: ThemeChoice,
): Promise<boolean> {
  try {
    const client = getSignupZitadelAdminClient();
    await client.setUserMetadata(userId, THEME_METADATA_KEY, theme);
    return true;
  } catch (err) {
    logger.warn(
      { err: String(err), userId },
      "[user-prefs/theme] failed to write theme to Zitadel; cookie still set on this device",
    );
    return false;
  }
}
