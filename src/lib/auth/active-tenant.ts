/**
 * Active-tenant cookie I/O.
 *
 * The dashboard removed `tenant` from the encrypted Auth.js JWT under spec
 * `tenant-membership-not-in-jwt`. Active tenant now lives in a separate
 * HMAC-signed `gibson_active_tenant` cookie that the user controls via the
 * tenant-switcher UI. The cookie is *a hint* — every read re-validates the
 * cookie's tenant against the user's current FGA memberships, so a revoked
 * membership immediately clears the cookie and bounces the user to the
 * picker on the next request.
 *
 * Cookie format: `<tenant_id>.<hex_hmac_sha256(tenant_id, AUTH_SECRET)>`.
 *
 * @module auth/active-tenant
 */

import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { cache } from 'react';

import { getMyMemberships, type Membership } from './membership';

const COOKIE_NAME = 'gibson_active_tenant';
const COOKIE_MAX_AGE_S = 8 * 60 * 60; // 8h, aligned with Auth.js session

// ---------------------------------------------------------------------------
// Public errors
// ---------------------------------------------------------------------------

export class NoActiveTenantError extends Error {
  constructor() {
    super('no active tenant cookie set');
    this.name = 'NoActiveTenantError';
  }
}

export class StaleActiveTenantError extends Error {
  readonly tenantId: string;
  constructor(tenantId: string) {
    super(`active tenant '${tenantId}' is no longer in the user's memberships`);
    this.name = 'StaleActiveTenantError';
    this.tenantId = tenantId;
  }
}

// ---------------------------------------------------------------------------
// HMAC sign/verify
// ---------------------------------------------------------------------------

function authSecret(): Buffer {
  const s = process.env['AUTH_SECRET'];
  if (!s || s.length < 16) {
    // Hard-fail rather than ship a guessable secret in any environment.
    throw new Error('AUTH_SECRET is missing or too short to sign cookies');
  }
  return Buffer.from(s, 'utf8');
}

function sign(tenantId: string): string {
  return createHmac('sha256', authSecret()).update(tenantId).digest('hex');
}

/**
 * Constant-time HMAC compare. Returns false on length mismatch so callers
 * cannot use timing to learn anything about the expected signature.
 */
function verify(tenantId: string, providedHex: string): boolean {
  const expected = Buffer.from(sign(tenantId), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

function encodeCookie(tenantId: string): string {
  return `${tenantId}.${sign(tenantId)}`;
}

/**
 * Returns the tenantId encoded in `value` if the HMAC is valid, else null.
 * Treats every malformed/tampered cookie as null — callers cannot
 * distinguish "absent" from "tampered" from this function (intentional —
 * tampering goes to the picker, not an error page).
 */
function decodeCookie(value: string | undefined): string | null {
  if (!value) return null;
  const lastDot = value.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === value.length - 1) return null;
  const tenantId = value.slice(0, lastDot);
  const sig = value.slice(lastDot + 1);
  if (!verify(tenantId, sig)) return null;
  return tenantId;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the active tenant ID for the current request.
 *
 * Per-request memoized via `react.cache()` so multiple Server Components
 * within one render share a single membership lookup.
 *
 * @throws {NoActiveTenantError} when no cookie is set or it is tampered.
 * @throws {StaleActiveTenantError} when the cookie names a tenant the
 *   user is no longer a member of. Caller should clear the cookie and
 *   redirect to `/select-tenant`.
 */
export const getActiveTenant = cache(async (): Promise<string> => {
  const jar = await cookies();
  const tenantId = decodeCookie(jar.get(COOKIE_NAME)?.value);
  if (!tenantId) {
    throw new NoActiveTenantError();
  }
  const memberships = await getMyMemberships();
  if (!memberships.some((m: Membership) => m.tenantId === tenantId)) {
    throw new StaleActiveTenantError(tenantId);
  }
  return tenantId;
});

/**
 * Server Action helper: writes the active-tenant cookie after validating
 * that the caller is a member of the requested tenant. Use only inside a
 * Server Action; it depends on `cookies()` being writable.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, reason }` on failure
 * (membership not held, or daemon-side resolution failed). Never throws —
 * the picker UI maps the reason to an inline error.
 */
export async function setActiveTenant(
  tenantId: string,
): Promise<{ ok: true } | { ok: false; reason: 'not_a_member' | 'resolution_failed' }> {
  if (!tenantId) {
    return { ok: false, reason: 'not_a_member' };
  }
  let memberships: Membership[];
  try {
    memberships = await getMyMemberships();
  } catch {
    return { ok: false, reason: 'resolution_failed' };
  }
  if (!memberships.some((m) => m.tenantId === tenantId)) {
    return { ok: false, reason: 'not_a_member' };
  }
  const jar = await cookies();
  jar.set(COOKIE_NAME, encodeCookie(tenantId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: COOKIE_MAX_AGE_S,
  });
  return { ok: true };
}

/**
 * Clears the active-tenant cookie. Used by middleware on stale-cookie
 * detection and by the explicit "switch tenant" UI path.
 */
export async function clearActiveTenant(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

// Internal export used by middleware to read the raw cookie without
// throwing — it needs to distinguish "no cookie" from "stale cookie" from
// "invalid HMAC" to choose the right error code, and `getActiveTenant`
// collapses the latter two.
export async function readRawActiveTenant(): Promise<{
  status: 'absent' | 'invalid' | 'present';
  tenantId?: string;
}> {
  const jar = await cookies();
  const cookieValue = jar.get(COOKIE_NAME)?.value;
  if (!cookieValue) return { status: 'absent' };
  const tenantId = decodeCookie(cookieValue);
  if (!tenantId) return { status: 'invalid' };
  return { status: 'present', tenantId };
}

export const ACTIVE_TENANT_COOKIE_NAME = COOKIE_NAME;
