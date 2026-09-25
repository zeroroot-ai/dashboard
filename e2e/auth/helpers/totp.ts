// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Minimal RFC 6238 TOTP generator for e2e tests (hosted#193).
 *
 * Once `forceMfa` is enforced (a sibling change to this one, plan-193),
 * every Playwright login goes through Zitadel's `/ui/v2/login/mfa/set`
 * (first-factor enrollment) or `/ui/v2/login/otp/time-based` (an
 * already-registered factor) before it reaches the dashboard. This module
 * is a dependency-free TOTP implementation (Node's built-in `crypto` only,
 * no new package) so `login-via-zitadel-v2.ts` can compute a fresh 6-digit
 * code from the secret Zitadel's enrollment page displays.
 *
 * Deliberately NOT a general-purpose TOTP library: 30-second step, 6
 * digits, SHA-1, matching Zitadel's own authenticator-app defaults. If
 * Zitadel's enrollment page ever offers a different algorithm or digit
 * count, this needs updating alongside it.
 */

import { createHmac } from "crypto";

/** Decodes an RFC 4648 base32 string (Zitadel's TOTP secret encoding). */
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const val = alphabet.indexOf(char);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Computes the RFC 6238 TOTP code for `base32Secret` at `atMs` (default:
 * now). 30-second step, 6 digits, HMAC-SHA1 — Zitadel's authenticator-app
 * defaults.
 */
export function computeTotp(base32Secret: string, atMs: number = Date.now()): string {
  const key = base32Decode(base32Secret);
  const counter = Math.floor(atMs / 1000 / 30);

  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  return String(binary % 1_000_000).padStart(6, "0");
}

/**
 * Per-test-user TOTP secrets, keyed by email, held for the lifetime of the
 * test process. Each e2e test creates a fresh user (see
 * `e2e/auth/helpers/fixtures.ts` `uniqueEmail()`), so cross-run persistence
 * is not needed — this only makes repeated logins for the SAME user within
 * one test run deterministic, rather than re-enrolling a new factor each
 * time.
 */
const secretsByEmail = new Map<string, string>();

export function rememberTotpSecret(email: string, base32Secret: string): void {
  secretsByEmail.set(email, base32Secret);
}

export function getTotpSecret(email: string): string | undefined {
  return secretsByEmail.get(email);
}
