/**
 * countSignInMethods
 *
 * Returns the total number of distinct sign-in methods a user has available.
 * Used by unlinkSocialAction to enforce the last-credential guard: a user
 * must always retain at least one sign-in method so they cannot be locked out.
 *
 * Counting rules:
 *  - Email+password counts as 1 when the user has a "credential" provider
 *    account row in the dashboard's `account` table (Auth.js adapter schema).
 *  - Each linked social provider counts as 1 additional method.
 *
 * The `account` table stores one row per identity:
 *  - providerId = "credential"  → email+password
 *  - providerId = "github" | "gitlab" | "google" | "microsoft" → social
 *
 * @param accounts - The array returned by auth.api.listAccounts (or equivalent
 *   direct DB query). Accepts the raw account rows so the function stays pure
 *   and testable without a live auth instance.
 */

interface AccountRow {
  providerId: string;
  [key: string]: unknown;
}

/**
 * Count the number of distinct sign-in methods available to the user.
 *
 * @param accounts - Raw account rows from the dashboard's `account` table
 *   (Auth.js adapter schema).
 * @returns Integer >= 0.
 */
export function countSignInMethods(accounts: AccountRow[]): number {
  if (!Array.isArray(accounts) || accounts.length === 0) return 0;

  // De-duplicate by providerId: each unique provider ID is one method.
  const providerIds = new Set(accounts.map((a) => a.providerId));
  return providerIds.size;
}
