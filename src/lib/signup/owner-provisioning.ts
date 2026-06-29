/**
 * Owner provisioning, daemon-backed founding-owner identity creation.
 *
 * `signupAction` / `completeSignup` call `provisionSignupOwner` to create (or
 * resume) the founding-owner Zitadel human user. The daemon's
 * `gibson.tenant.v1.SignupService.Signup` RPC performs the IdP-admin work
 * (create-or-resume user, set password, send verification email) using the
 * daemon's own Zitadel admin credential. The dashboard no longer holds a
 * privileged Zitadel "signup-bot" PAT (dashboard#812, E9, ADR-0043/0044).
 *
 * Like `setSignupProgress` (progress-store.ts), Signup is UNAUTHENTICATED:
 * it runs pre-tenant, before any session or membership exists. It is dialed
 * via the SAME `serviceClient(Service, '')` service-acting transport with an
 * empty tenant that the unauthenticated `SetSignupProgress` RPC uses, NOT the
 * tenant-scoped userClient (which fail-closes via getActiveTenant). The opaque
 * `attemptId` UUID is the correlation capability.
 *
 * SECURITY: the founding-owner password is forwarded to the daemon in the RPC
 * request body only (write-only proto field 8). It is never logged, persisted,
 * or returned.
 */

import 'server-only';

import { serviceClient } from '@/src/lib/gibson-client';
import { SignupService } from '@/src/gen/gibson/tenant/v1/signup_pb';

/** Inputs to `provisionSignupOwner`. */
interface ProvisionSignupOwnerInput {
  /** Opaque single-use signup-attempt UUID; correlates with the progress stream. */
  attemptId: string;
  /** Founding owner's email address (login name). */
  ownerEmail: string;
  /** Human-readable workspace / company name; the daemon derives the slug. */
  workspaceName: string;
  /** Canonical plan id ("team" | "org" | "enterprise"). */
  tier: string;
  /** Owner's given name (optional). */
  ownerFirstName?: string;
  /** Owner's family name (optional). */
  ownerLastName?: string;
  /** Pre-created Stripe customer id to pin for deterministic billing adoption (optional). */
  stripeCustomerId?: string;
  /**
   * Founding owner's initial password (the value the user typed). Forwarded to
   * the daemon's IdP-admin set-password call. SECURITY: write-only; never logged.
   */
  password: string;
}

/** Outcome of owner provisioning. */
interface ProvisionSignupOwnerResult {
  /** Deterministic tenant slug the daemon derived from the workspace name. */
  tenantId: string;
  /** Zitadel id of the provisioned founding-owner human user. */
  ownerUserId: string;
  /** True when the owner user already existed (idempotent retry / resume). */
  alreadyExisted: boolean;
}

/**
 * Provision (or resume) the founding-owner Zitadel user via the daemon
 * `SignupService.Signup` RPC. Idempotent on owner email: a retry resumes the
 * existing user (resetting its password) and returns `alreadyExisted: true`.
 *
 * Throws a `ConnectError` on RPC-level failure; callers map it to a signup
 * failure code.
 */
export async function provisionSignupOwner(
  input: ProvisionSignupOwnerInput,
): Promise<ProvisionSignupOwnerResult> {
  // Service-acting client with an empty tenant: Signup is pre-tenant and
  // unauthenticated, exactly like setSignupProgress. Do NOT use userClient.
  const resp = await serviceClient(SignupService, '').signup({
    attemptId: input.attemptId,
    ownerEmail: input.ownerEmail,
    workspaceName: input.workspaceName,
    tier: input.tier,
    ownerFirstName: input.ownerFirstName ?? '',
    ownerLastName: input.ownerLastName ?? '',
    stripeCustomerId: input.stripeCustomerId ?? '',
    password: input.password,
  });

  return {
    tenantId: resp.tenantId,
    ownerUserId: resp.ownerUserId,
    alreadyExisted: resp.alreadyExisted,
  };
}
