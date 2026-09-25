// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Active-tenant resolver (ADR-0093 decision 4).
 *
 * A person's tenant comes from their token's verified Zitadel org, resolved
 * server-side at sign-in and stamped onto the encrypted Auth.js session as
 * `session.tenantId` (see `auth.ts`'s `jwt` callback and
 * `src/lib/auth/session-tenant.ts`). There is no picker, no
 * `gibson_active_tenant` cookie, and no client-supplied tenant of any kind:
 * a person cannot choose or switch tenants, because they have exactly one.
 *
 * ## Canonical resolver
 *
 * Use `requireActiveTenant()` as the single fail-closed resolver for the
 * active tenant. It reads `session.tenantId` and re-validates it against the
 * caller's current FGA membership on every request (via `getMyMemberships()`,
 * which calls the daemon), so a revoked membership takes effect immediately
 * rather than waiting for the next sign-in.
 *
 * ### Error-mapping helpers
 *
 * Never invent missing-tenant behavior inline. Use the three typed helpers:
 *
 * - `activeTenantApiResponse(err, opts)`, for API route handlers;
 *   returns `NextResponse` with 412 + `{ error, code }`.
 * - `activeTenantActionResult(err)`, for Server Actions;
 *   returns `{ ok: false, code: 'no_active_tenant' | 'stale_active_tenant' }`.
 * - `activeTenantPageRedirect(err)`, for RSC pages; redirects to `/onboarding`
 *   for `NoActiveTenantError`, or `/api/auth/federated-signout` for
 *   `StaleActiveTenantError` (throws Next.js `NEXT_REDIRECT`).
 *
 * @module auth/active-tenant
 */

import 'server-only';

import { redirect } from 'next/navigation';
import { cache } from 'react';
import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { getMyMemberships, type Membership } from './membership';

// ---------------------------------------------------------------------------
// Branded TenantId (dashboard#815)
// ---------------------------------------------------------------------------
//
// `TenantId` is an opaque brand over `string`. A raw `string` is NOT
// assignable to `TenantId`, so a lenient value (`'default'`, a smeared
// `session.tenantId || ''`, an un-revalidated value, …) cannot be passed
// where a *validated* active tenant is required, it fails to compile, not
// merely fail-closed at runtime.
//
// The ONLY fail-closed mint is `requireActiveTenant()` below, which reads
// the session's server-resolved tenant and re-checks FGA membership before
// branding the value. The brand makes the runtime invariant (PRD #567,
// dashboard#583) a *type-system* invariant.
//
// The single documented escape hatch is `unsafeTenantId()`: the service-acting
// transport (`serviceClient`) and the Stripe-webhook tenant attribution have
// no user context and legitimately carry a daemon-derived or empty tenant
// string. Those call sites brand explicitly and greppably; everything else
// must route through the mint.

/**
 * Opaque, validated active-tenant identifier.
 *
 * Produced only by `requireActiveTenant()` (the fail-closed mint) or, at the
 * two documented non-user boundaries, by `unsafeTenantId()`. A plain
 * `string` is not assignable to `TenantId`.
 */
export type TenantId = string & { readonly __brand: 'TenantId' };

/**
 * The sole non-validated `TenantId` mint, for the service-acting transport
 * and webhook tenant attribution, neither of which has a signed-in user to
 * validate against. Every other producer of `TenantId` MUST go through
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
    super('your account has no tenant');
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
// Core resolver (memoized per request)
// ---------------------------------------------------------------------------

/**
 * Canonical fail-closed resolver for the active tenant.
 *
 * This is the ONE function all handlers should call to obtain the acting
 * tenant ID. It is per-request memoized (via `react.cache()`) so the
 * session read and the FGA membership lookup are shared across Server
 * Components within a single render.
 *
 * Re-validates `session.tenantId` against `getMyMemberships()` on every
 * call — never just trusting the value the session cookie carries — so a
 * membership removal takes effect at once rather than waiting for the next
 * sign-in.
 *
 * When there is no tenant, or the resolved tenant is stale, the function
 * throws typed errors; use the error-mapping helpers below to translate
 * those errors into the appropriate response for each layer:
 *   - API route handler  → `activeTenantApiResponse(err, opts)`
 *   - Server Action      → `activeTenantActionResult(err)`
 *   - RSC page           → `activeTenantPageRedirect(err)`
 *
 * @throws {NoActiveTenantError} the session carries no tenant (the Platform
 *   owner, or a tenant still provisioning).
 * @throws {StaleActiveTenantError} the session's tenant is no longer a
 *   membership the caller holds (revoked since sign-in).
 */
export const requireActiveTenant = cache(async (): Promise<TenantId> => {
  const session = await auth();
  const tenantId = session?.tenantId;
  if (!tenantId) {
    throw new NoActiveTenantError();
  }
  const memberships: Membership[] = await getMyMemberships();
  if (memberships.length !== 1 || memberships[0]?.tenantId !== tenantId) {
    throw new StaleActiveTenantError(tenantId);
  }
  // The value is the session's server-resolved tenant AND a confirmed
  // current membership: brand it.
  return tenantId as TenantId;
});

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
      { error: 'Your account has no tenant.', code: 'no_active_tenant' },
      { status: 412, headers: opts.headers },
    );
  }
  if (err instanceof StaleActiveTenantError) {
    return NextResponse.json(
      { error: 'Your tenant membership is no longer valid. Sign in again.', code: 'stale_active_tenant' },
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
 * RSC page handler for a missing or stale active tenant.
 *
 * Call this from RSC page components that have caught an error from
 * `requireActiveTenant()`. A `NoActiveTenantError` (no tenant yet) redirects
 * to `/onboarding`; a `StaleActiveTenantError` (membership revoked since
 * sign-in) redirects to `/api/auth/federated-signout` so the next sign-in
 * re-resolves the tenant cleanly. Any other error is re-thrown. The function
 * calls Next.js `redirect()`, which throws a `NEXT_REDIRECT` exception; it
 * never returns normally for the two handled error types.
 *
 * @example
 * ```ts
 * export default async function Page() {
 *   let tenantId: string;
 *   try {
 *     tenantId = await requireActiveTenant();
 *   } catch (err) {
 *     activeTenantPageRedirect(err);
 *   }
 *   // ...
 * }
 * ```
 */
export function activeTenantPageRedirect(err: unknown): never {
  if (err instanceof StaleActiveTenantError) {
    redirect('/api/auth/federated-signout');
  }
  if (err instanceof NoActiveTenantError) {
    redirect('/onboarding');
  }
  throw err;
}
