/**
 * fixtures.ts — shared test fixture generators for the auth e2e suite.
 *
 * Each test creates its own tenant / user so parallel runs never collide.
 * The slug generator encodes a timestamp + 6 random hex chars to stay
 * DNS-safe and deterministic-enough for debugging (grep by the timestamp
 * prefix).
 *
 * Env wiring:
 *   PLAYWRIGHT_BASE_URL  — overrides http://localhost:30081 (kind gibson)
 */

import crypto from "crypto";

// ---------------------------------------------------------------------------
// Base URL
// ---------------------------------------------------------------------------

/**
 * The target base URL. Defaults to the kind `gibson` dev cluster port
 * (NodePort 30081).
 */
export const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:30081";

// ---------------------------------------------------------------------------
// Unique slug / credential generation
// ---------------------------------------------------------------------------

/**
 * Returns a DNS-safe, unique company slug suitable for use as a Zitadel
 * organisation slug.
 *
 * Format: `e2e-<timestamp_base36>-<6 hex chars>`
 * Example: `e2e-lhqvz12a-3f8b2c`
 *
 * All characters are lowercase alphanumeric or hyphens, starting with a
 * letter — satisfies the `/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/` rule.
 */
export function uniqueSlug(): string {
  const ts = Date.now().toString(36); // base36 timestamp (~8 chars)
  const rand = crypto.randomBytes(3).toString("hex"); // 6 hex chars
  return `e2e-${ts}-${rand}`;
}

/**
 * Returns a unique display name for a company.
 */
export function uniqueCompanyName(): string {
  return `E2E Co ${Date.now().toString(36).toUpperCase()}`;
}

/**
 * Returns a unique email address using the slug as the local part.
 * Safe for any mail sink (log provider / mailhog).
 */
export function uniqueEmail(slug?: string): string {
  const local = slug ?? uniqueSlug();
  return `${local}@e2e.test`;
}

/**
 * Returns a password that satisfies the Gibson password policy:
 *  - minimum 8 characters
 *  - at least one uppercase, one lowercase, one digit, one special char
 *
 * This password is intentionally NOT in any HIBP breach list (it is
 * randomly generated; the 2-s HIBP check timeout means the suite will
 * usually proceed even when HIBP is enabled).
 */
export function securePassword(): string {
  const rand = crypto.randomBytes(6).toString("hex"); // 12 hex chars
  // Ensure policy: prefix with uppercase + special + digit
  return `Ae1!${rand}`;
}

/**
 * A convenience bundle: generate a unique set of user credentials for one
 * test run. Each call produces a fresh, non-colliding set.
 */
export interface UserCredentials {
  email: string;
  password: string;
  companyName: string;
  slug: string;
}

export function generateUserCredentials(): UserCredentials {
  const slug = uniqueSlug();
  return {
    email: uniqueEmail(slug),
    password: securePassword(),
    companyName: `E2E Company ${slug.toUpperCase()}`,
    slug,
  };
}
