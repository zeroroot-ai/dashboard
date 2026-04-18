/**
 * countSignInMethods
 *
 * Returns the total number of distinct sign-in methods a user has available.
 * Used by unlinkSocialAction to enforce the last-credential guard: a user
 * must always retain at least one sign-in method so they cannot be locked out.
 *
 * Counting rules:
 *  - Email+password counts as 1 when the user has a "credential" provider
 *    account row in Better Auth's `account` table.
 *  - Each linked social provider counts as 1 additional method.
 *
 * Better Auth's `account` table stores one row per identity:
 *  - providerId = "credential"  → email+password
 *  - providerId = "github" | "gitlab" | "google" | "microsoft" → social
 *
 * @param accounts - The array returned by auth.api.listAccounts (or equivalent
 *   direct DB query). Accepts the raw account rows so the function stays pure
 *   and testable without a live auth instance.
 */

export interface AccountRow {
  providerId: string;
  [key: string]: unknown;
}

/**
 * Count the number of distinct sign-in methods available to the user.
 *
 * @param accounts - Raw account rows from Better Auth's account table.
 * @returns Integer >= 0.
 */
export function countSignInMethods(accounts: AccountRow[]): number {
  if (!Array.isArray(accounts) || accounts.length === 0) return 0;

  // De-duplicate by providerId: each unique provider ID is one method.
  const providerIds = new Set(accounts.map((a) => a.providerId));
  return providerIds.size;
}
