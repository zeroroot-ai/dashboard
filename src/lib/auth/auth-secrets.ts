// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The server-side signing secrets of the dashboard, current first.
 *
 * AUTH_SECRET encrypts each Auth.js session cookie and signs the signup
 * cookie. AUTH_SECRET_PREVIOUS is the secret it replaced. The chart rotates
 * the pair (ADR-0171): a rotation moves the old AUTH_SECRET into
 * AUTH_SECRET_PREVIOUS and writes a new AUTH_SECRET. The dashboard signs with
 * the current secret only and accepts a cookie of either, so a rotation signs
 * nobody out. The next rotation drops the old previous secret, and a cookie of
 * it is refused.
 *
 * An empty or absent AUTH_SECRET_PREVIOUS means no rotation is in progress.
 */
export function authSecrets(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const out: string[] = [];
  for (const v of [env.AUTH_SECRET, env.AUTH_SECRET_PREVIOUS]) {
    if (typeof v === 'string' && v.length > 0 && !out.includes(v)) {
      out.push(v);
    }
  }
  return out;
}
