/**
 * Signup verification + owner provisioning, daemon-backed.
 *
 * Four unauthenticated `gibson.tenant.v1.SignupService` RPCs, in the order the
 * flow uses them:
 *
 *   requestSignupVerification — records the request and emails a single-use
 *                               link. Creates no identity and no billing
 *                               object.
 *   redeemSignupVerification  — exchanges the emailed token for a short-lived
 *                               completion session.
 *   attachSignupCustomer      — pins the billing customer to that session, so
 *                               the daemon reads the customer id from its own
 *                               row instead of trusting the completion call.
 *   completeSignupOwner       — creates the founding-owner user and enqueues
 *                               the tenant. Requires the session.
 *
 * ORDERING is enforced daemon-side, not here. The completion RPC takes no
 * email, workspace name or tier — it reads all of them back from the
 * verification row the session resolves to — so a caller cannot prove control
 * of one address and provision another. Nothing in this module can reorder the
 * flow into something weaker.
 *
 * Like `setSignupProgress` (progress-store.ts) these are UNAUTHENTICATED: they
 * run pre-tenant, before any session or membership exists. They are dialed via
 * the SAME `serviceClient(Service, '')` service-acting transport with an empty
 * tenant that the unauthenticated `SetSignupProgress` RPC uses, NOT the
 * tenant-scoped userClient (which fail-closes via getActiveTenant).
 *
 * SECURITY: the founding-owner password reaches the daemon in the completion
 * request body only, and only after the address has been proven. It is never
 * logged, persisted, or returned.
 */

import 'server-only';

import { serviceClient } from '@/src/lib/gibson-client';
import { SignupService } from '@/src/gen/gibson/tenant/v1/signup_pb';

/** Inputs to `requestSignupVerification`. */
interface RequestSignupVerificationInput {
  /** Opaque signup-attempt UUID; correlates with the progress stream. */
  attemptId: string;
  /** Address to verify. Normalized server-side; the normalized value is authoritative. */
  ownerEmail: string;
  /** Human-readable workspace / company name; the daemon derives the slug. */
  workspaceName: string;
  /** Canonical plan id ("team" | "org" | "enterprise"). */
  tier: string;
  /** Owner's given name (optional). */
  ownerFirstName?: string;
  /** Owner's family name (optional). */
  ownerLastName?: string;
  /** Requester IP as the edge resolved it; drives the per-source abuse budgets. */
  clientIp: string;
}

/**
 * Ask the daemon to send a verification link.
 *
 * Returns nothing on success, deliberately. The response is empty and identical
 * for every accepted request: whether the address already has an account is not
 * something an anonymous caller may learn, and the daemon discloses it only to
 * the mailbox that owns the address. Callers must not branch on it either.
 *
 * Throws a `ConnectError` on RPC-level failure; callers map it to a signup
 * failure code.
 */
export async function requestSignupVerification(
  input: RequestSignupVerificationInput,
): Promise<void> {
  await serviceClient(SignupService, '').requestEmailVerification({
    attemptId: input.attemptId,
    ownerEmail: input.ownerEmail,
    workspaceName: input.workspaceName,
    tier: input.tier,
    ownerFirstName: input.ownerFirstName ?? '',
    ownerLastName: input.ownerLastName ?? '',
    clientIp: input.clientIp,
  });
}

/** What a redeemed verification hands back. */
export interface RedeemedSignupVerification {
  /**
   * Capability for the completion call. Short-lived. The caller stores it in an
   * httpOnly cookie and never renders it.
   */
  verifiedSessionToken: string;
  /** The attempt the verification was issued under; resume the progress stream with it. */
  attemptId: string;
  /** The address that was proven. Safe to show to whoever holds the token. */
  ownerEmail: string;
  /** Echoed for display on the completion page. */
  workspaceName: string;
  tier: string;
}

/**
 * Exchange the raw emailed token for a completion session.
 *
 * Single-use. Every failure — unknown, expired, already redeemed, malformed —
 * comes back as the same `PermissionDenied`, so callers must not try to
 * distinguish them for the user either: doing so would rebuild the oracle the
 * daemon is careful not to expose.
 */
export async function redeemSignupVerification(input: {
  token: string;
  clientIp: string;
}): Promise<RedeemedSignupVerification> {
  const resp = await serviceClient(SignupService, '').redeemEmailVerification({
    token: input.token,
    clientIp: input.clientIp,
  });
  return {
    verifiedSessionToken: resp.verifiedSessionToken,
    attemptId: resp.attemptId,
    ownerEmail: resp.ownerEmail,
    workspaceName: resp.workspaceName,
    tier: resp.tier,
  };
}

/**
 * Pin the billing customer to the verified session.
 *
 * The completion call carries no customer id; the daemon reads it from the row
 * this writes. Only reachable with a live verified session, which is what keeps
 * billing objects from existing for unproven addresses.
 */
export async function attachSignupCustomer(input: {
  verifiedSessionToken: string;
  stripeCustomerId: string;
  clientIp: string;
}): Promise<void> {
  await serviceClient(SignupService, '').attachSignupCustomer({
    verifiedSessionToken: input.verifiedSessionToken,
    stripeCustomerId: input.stripeCustomerId,
    clientIp: input.clientIp,
  });
}

/** Outcome of owner provisioning. */
interface CompleteSignupOwnerResult {
  /** Deterministic tenant slug the daemon derived from the workspace name. */
  tenantId: string;
  /** Zitadel id of the founding-owner human user this call created. */
  ownerUserId: string;
}

/**
 * Complete a verified signup: create the founding-owner user and enqueue the
 * tenant for operator-pull provisioning.
 *
 * NOT idempotent-by-resume. If the address acquired an account between the
 * verification email and this call, the daemon returns `AlreadyExists` and
 * writes no credential to that account.
 *
 * Throws a `ConnectError` on RPC-level failure; callers map it to a signup
 * failure code.
 */
export async function completeSignupOwner(input: {
  attemptId: string;
  verifiedSessionToken: string;
  password: string;
  clientIp: string;
}): Promise<CompleteSignupOwnerResult> {
  const resp = await serviceClient(SignupService, '').signup({
    attemptId: input.attemptId,
    verifiedSessionToken: input.verifiedSessionToken,
    password: input.password,
    clientIp: input.clientIp,
  });

  return { tenantId: resp.tenantId, ownerUserId: resp.ownerUserId };
}
