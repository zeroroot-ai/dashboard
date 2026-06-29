/**
 * Active-tenant cookie I/O.
 *
 * The dashboard removed `tenant` from the encrypted Auth.js JWT under spec
 * `tenant-membership-not-in-jwt`. Active tenant now lives in a separate
 * HMAC-signed `gibson_active_tenant` cookie that the user controls via the
 * tenant-switcher UI. The cookie is *a hint*, every read re-validates the
 * cookie's tenant against the user's current FGA memberships, so a revoked
 * membership immediately clears the cookie and bounces the user to the
 * picker on the next request.
 *
 * Cookie format: `<tenant_id>.<hex_hmac_sha256(tenant_id, AUTH_SECRET)>`.
 *
 * ## Canonical resolver
 *
 * Use `requireActiveTenant()` as the single fail-closed resolver for the
 * active tenant. It is an alias for `getActiveTenant()` with an explicit
 * name that makes the fail-closed contract visible at the call-site.
 *
 * ### Error-mapping helpers
 *
 * Never invent missing-tenant behavior inline. Use the three typed helpers:
 *
 * - `activeTenantApiResponse(err, opts)`, for API route handlers;
 *   returns `NextResponse` with 412 + `{ error, code: 'no_active_tenant' }`.
 * - `activeTenantActionResult(err)`, for Server Actions;
 *   returns `{ ok: false, code: 'no_active_tenant' | 'stale_active_tenant' }`.
 * - `activeTenantPageRedirect()`, for RSC pages;
 *   calls `redirect('/select-tenant')` (throws Next.js `NEXT_REDIRECT`).
 *
 * @module auth/active-tenant
 */

import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { NextResponse } from 'next/server';

import { getMyMemberships, type Membership } from './membership';

const COOKIE_NAME = 'gibson_active_tenant';
const COOKIE_MAX_AGE_S = 8 * 60 * 60; // 8h, aligned with Auth.js session

// ---------------------------------------------------------------------------
// Branded TenantId (dashboard#815)
// ---------------------------------------------------------------------------
//
// `TenantId` is an opaque brand over `string`. A raw `string` is NOT
// assignable to `TenantId`, so a lenient value (`'default'`, a smeared
// `session.user.tenantId || ''`, an un-revalidated cookie value, …) cannot be
// passed where a *validated* active tenant is required, it fails to compile,
// not merely fail-closed at runtime.
//
// The ONLY fail-closed mint is `requireActiveTenant()` / `getActiveTenant()`
// below, which HMAC-validates the cookie and re-checks FGA memberships before
// branding the value. The brand makes the runtime invariant (PRD #567,
// dashboard#583) a *type-system* invariant.
//
// The single documented escape hatch is `unsafeTenantId()`: the service-acting
// transport (`serviceClient`) and the Stripe-webhook tenant attribution have
// no cookie/user context and legitimately carry a daemon-derived or empty
// tenant string. Those call sites brand explicitly and greppably; everything
// else must route through the mint.

/**
 * Opaque, validated active-tenant identifier.
 *
 * Produced only by `requireActiveTenant()` / `getActiveTenant()` (the
 * fail-closed mint) or, at the two documented non-user boundaries, by
 * `unsafeTenantId()`. A plain `string` is not assignable to `TenantId`.
 */
export type TenantId = string & { readonly __brand: 'TenantId' };

/**
 * The sole non-validated `TenantId` mint, for the service-acting transport
 * and webhook tenant attribution, neither of which has a cookie or a signed-in
 * user to validate against. Every other producer of `TenantId` MUST go through
 * `requireActiveTenant()`.
 *
 * Naming is intentionally loud: an `unsafeTenantId(...)` call in a user-facing
 * route handler is a review smell (it bypasses the fail-closed mint).
 */
export function unsafeTenantId(value: string): TenantId {
  return value as TenantId;
}

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
 * Treats every malformed/tampered cookie as null, callers cannot
 * distinguish "absent" from "tampered" from this function (intentional -
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
// Core resolver (memoized per request)
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
export const getActiveTenant = cache(async (): Promise<TenantId> => {
  const jar = await cookies();
  const tenantId = decodeCookie(jar.get(COOKIE_NAME)?.value);
  if (!tenantId) {
    throw new NoActiveTenantError();
  }
  const memberships = await getMyMemberships();
  if (!memberships.some((m: Membership) => m.tenantId === tenantId)) {
    throw new StaleActiveTenantError(tenantId);
  }
  // The value is now HMAC-valid AND a confirmed current membership: brand it.
  return tenantId as TenantId;
});

/**
 * Canonical fail-closed resolver for the active tenant.
 *
 * This is the ONE function all handlers should call to obtain the acting
 * tenant ID. It is per-request memoized (via `react.cache()`) so the
 * FGA membership lookup is shared across Server Components within a single
 * render.
 *
 * When the cookie is absent, tampered, or names a revoked tenant the
 * function throws typed errors, use the error-mapping helpers below to
 * translate those errors into the appropriate response for each layer:
 *   - API route handler  → `activeTenantApiResponse(err, opts)`
 *   - Server Action      → `activeTenantActionResult(err)`
 *   - RSC page           → `activeTenantPageRedirect()`
 *
 * @throws {NoActiveTenantError}, cookie absent or HMAC tampered.
 * @throws {StaleActiveTenantError}, cookie valid but tenant revoked.
 */
export const requireActiveTenant = getActiveTenant;

// ---------------------------------------------------------------------------
// Error-mapping helpers
// ---------------------------------------------------------------------------

/**
 * Response body shape for a missing-active-tenant API error.
 *
 * HTTP status: 412 Precondition Failed.
 * The `code` field is stable; clients can branch on it programmatically.
 */
interface NoActiveTenantApiBody {
  error: string;
  code: 'no_active_tenant' | 'stale_active_tenant';
}

interface ApiResponseOptions {
  /**
   * Outgoing headers bag, e.g. `{ [CORRELATION_HEADER]: id }`.
   * Merged into the 412 response headers.
   */
  headers?: Record<string, string>;
}

/**
 * Translate a `NoActiveTenantError` or `StaleActiveTenantError` thrown by
 * `requireActiveTenant()` into a canonical 412 `NextResponse` for use in
 * API route handlers.
 *
 * Any other error type is re-thrown, this helper only handles the two
 * tenant-resolver errors.
 *
 * @example
 * ```ts
 * export async function GET(request: NextRequest) {
 *   let tenantId: string;
 *   try {
 *     tenantId = await requireActiveTenant();
 *   } catch (err) {
 *     return activeTenantApiResponse(err, { headers: { [CORRELATION_HEADER]: id } });
 *   }
 *   // ...
 * }
 * ```
 */
export function activeTenantApiResponse(
  err: unknown,
  opts: ApiResponseOptions = {},
): NextResponse<NoActiveTenantApiBody> {
  if (err instanceof NoActiveTenantError) {
    return NextResponse.json(
      { error: 'No active tenant. Select a tenant before making this request.', code: 'no_active_tenant' },
      { status: 412, headers: opts.headers },
    );
  }
  if (err instanceof StaleActiveTenantError) {
    return NextResponse.json(
      { error: 'Active tenant is no longer valid. Please re-select a tenant.', code: 'stale_active_tenant' },
      { status: 412, headers: opts.headers },
    );
  }
  throw err;
}

/**
 * Structured result type returned by `activeTenantActionResult`.
 *
 * Server Actions that call `requireActiveTenant()` should catch errors and
 * return this shape to the client, which maps `code` to a user-visible
 * message without inventing its own missing-tenant behavior.
 */
type ActiveTenantActionError =
  | { ok: false; code: 'no_active_tenant' }
  | { ok: false; code: 'stale_active_tenant' };

/**
 * Translate a `NoActiveTenantError` or `StaleActiveTenantError` thrown by
 * `requireActiveTenant()` into a structured `{ ok: false, code }` result for
 * use in Server Actions.
 *
 * Any other error type is re-thrown, this helper only handles the two
 * tenant-resolver errors.
 *
 * @example
 * ```ts
 * "use server";
 * export async function myAction(formData: FormData) {
 *   let tenantId: string;
 *   try {
 *     tenantId = await requireActiveTenant();
 *   } catch (err) {
 *     return activeTenantActionResult(err);
 *   }
 *   // ...
 *   return { ok: true };
 * }
 * ```
 */
export function activeTenantActionResult(err: unknown): ActiveTenantActionError {
  if (err instanceof NoActiveTenantError) {
    return { ok: false, code: 'no_active_tenant' };
  }
  if (err instanceof StaleActiveTenantError) {
    return { ok: false, code: 'stale_active_tenant' };
  }
  throw err;
}

/**
 * RSC page handler for a missing active tenant: redirect to `/select-tenant`.
 *
 * Call this from RSC page components that have resolved a missing-tenant
 * error via `requireActiveTenant()`. The function calls Next.js `redirect()`
 * which throws a `NEXT_REDIRECT` exception, it never returns normally.
 *
 * @example
 * ```ts
 * export default async function Page() {
 *   let tenantId: string;
 *   try {
 *     tenantId = await requireActiveTenant();
 *   } catch (err) {
 *     if (err instanceof NoActiveTenantError || err instanceof StaleActiveTenantError) {
 *       activeTenantPageRedirect();
 *     }
 *     throw err;
 *   }
 *   // ...
 * }
 * ```
 */
export function activeTenantPageRedirect(): never {
  redirect('/select-tenant');
}

// ---------------------------------------------------------------------------
// Cookie write helpers
// ---------------------------------------------------------------------------

/**
 * Server Action helper: writes the active-tenant cookie after validating
 * that the caller is a member of the requested tenant. Use only inside a
 * Server Action; it depends on `cookies()` being writable.
 *
 * Returns `{ ok: true }` on success, `{ ok: false, reason }` on failure
 * (membership not held, or daemon-side resolution failed). Never throws -
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
// throwing, it needs to distinguish "no cookie" from "stale cookie" from
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
