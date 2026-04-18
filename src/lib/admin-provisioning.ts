/**
 * SPIFFE-authenticated admin provisioning helpers.
 *
 * These are called by Next.js route handlers under /api/admin/provisioning/*
 * which are invoked by the tenant-operator via JWT-SVID Bearer auth. All
 * dashboard-side org operations go through Better Auth's adapter layer so
 * Better Auth's schema, hooks, and validations remain canonical — we only
 * bypass the HTTP session/cookie requirement because the operator is a
 * SPIFFE workload, not a browser session.
 */

import { NextRequest, NextResponse } from "next/server";
import { getOrgAdapter } from "better-auth/plugins/organization";
import { auth } from "@/src/lib/auth-server";

// better-auth's $context returns a strongly-typed PluginContext that
// getOrgAdapter can't accept as-is; the adapter expects a generic AuthContext
// from @better-auth/core which isn't a separately-exported type. Erase the
// narrower type with a pragmatic `any` passthrough — this is the seam between
// our code and better-auth internals, not a type we model.
type AnyCtx = Parameters<typeof getOrgAdapter>[0];
import { verifySpiffeBearer } from "@/src/lib/spiffe-verifier";
import { emitAuthAudit } from "@/src/lib/audit/auth";
import { getEmailProvider } from "@/src/lib/email/provider";
import { render as renderClaimEmail } from "@/src/lib/email/templates/claim";

// Claim invitation TTL — 14 days. Long enough to tolerate admin → user handoff
// lag (onboarding emails, out-of-office admins, etc.) while short enough that a
// stale invitation does not accumulate indefinitely in the DB. Matches the
// requirement in spec auth-flow-hardening §6.
const CLAIM_TTL_MS = 14 * 24 * 60 * 60 * 1000;

// Support address surfaced in every claim email. Configurable via env for ops
// who want to route support mail through a shared inbox rather than the
// dashboard's no-reply address.
function getSupportEmail(): string {
  return process.env.DASHBOARD_SUPPORT_EMAIL || "support@gibson.dev";
}

// Build the claim URL the operator-issued email points at. The token is the
// Better Auth invitation row's ID — opaque to the client. The claim page
// validates it server-side.
function buildClaimUrl(token: string): string {
  const base =
    process.env.BETTER_AUTH_URL ||
    process.env.DASHBOARD_PUBLIC_URL ||
    "http://localhost:3000";
  // Trim trailing slash so we always build `${base}/claim-account?...`.
  const trimmed = base.replace(/\/+$/, "");
  return `${trimmed}/claim-account?token=${encodeURIComponent(token)}`;
}

async function authz(req: NextRequest): Promise<
  | { ok: true; spiffeId: string }
  | { ok: false; status: number; body: { error: string } }
> {
  try {
    const { spiffeId } = await verifySpiffeBearer(
      req.headers.get("authorization"),
    );
    return { ok: true, spiffeId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 401,
      body: { error: `spiffe auth failed: ${msg}` },
    };
  }
}

export async function handleCreate(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  let body: {
    name?: string;
    slug?: string;
    metadata?: Record<string, string>;
    ownerId?: string;
    ownerEmail?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const { name, slug, metadata, ownerId, ownerEmail } = body ?? {};
  if (!name || !slug) {
    return NextResponse.json(
      { error: "name and slug are required" },
      { status: 400 },
    );
  }
  if (!ownerId && !ownerEmail) {
    return NextResponse.json(
      { error: "ownerId or ownerEmail is required" },
      { status: 400 },
    );
  }

  const ctx = (await auth.$context) as unknown as AnyCtx;
  const orgAdapter = getOrgAdapter(ctx);

  // Resolve caller's userId upfront — needed for both the idempotency owner
  // comparison (slug-exists path) and the new-org creation path below.
  // We resolve eagerly here so both branches share the same lookup logic.
  let callerUserId: string | undefined;
  if (ownerId) {
    const u = await ctx.internalAdapter.findUserById(ownerId);
    if (u) callerUserId = (u as unknown as { id: string }).id;
  }
  if (!callerUserId && ownerEmail) {
    const u = await ctx.internalAdapter.findUserByEmail(ownerEmail);
    // findUserByEmail returns { user, accounts } on hit
    const userRec =
      (u as unknown as { user?: { id: string } } | null)?.user ??
      (u as unknown as { id?: string } | null);
    if (userRec && "id" in userRec && userRec.id) {
      callerUserId = userRec.id;
    }
  }

  // Idempotency — slug already claimed: compare caller to existing owner.
  const existing = await orgAdapter.findOrganizationBySlug(slug);
  if (existing) {
    // Find the existing org's owner by listing members and filtering for role=owner.
    const memberList = await orgAdapter.listMembers({
      organizationId: existing.id,
      limit: 200,
    } as Parameters<typeof orgAdapter.listMembers>[0]);
    const members = Array.isArray(memberList)
      ? (memberList as Array<{ userId?: string; role?: string; id?: string }>)
      : ((memberList as { members?: Array<{ userId?: string; role?: string; id?: string }> })
          ?.members ?? []);
    const ownerRow = members.find(
      (m) => (m as { role?: string }).role === "owner",
    );
    const existingOwnerUserId = (ownerRow as { userId?: string } | undefined)
      ?.userId;

    if (callerUserId && existingOwnerUserId && callerUserId === existingOwnerUserId) {
      // Same caller retrying — idempotent replay.
      emitAuthAudit({
        action: "org_created",
        outcome: "ok",
        userId: callerUserId,
        targetTenant: slug,
        reason: "idempotent_replay",
      });
      return NextResponse.json({ id: existing.id });
    }

    // Different caller (or unresolvable caller) attempting to claim an already-owned slug.
    const auditUserId = callerUserId ?? "anonymous";
    emitAuthAudit({
      action: "signup_failed",
      outcome: "failed",
      userId: auditUserId,
      targetTenant: slug,
      reason: "slug_owned_by_other",
    });
    return NextResponse.json(
      { error: "SLUG_OWNED_BY_OTHER_USER", existingOwnerRedacted: true },
      { status: 409 },
    );
  }

  // Auto-create the owner user if missing. Operator-driven provisioning must
  // work even when the tenant's owner hasn't signed up yet — for example,
  // admin-seeded tenants, CLI-provisioned workspaces, or tests. The account
  // is shell-only (no credentials); the owner completes sign-up later via the
  // claim-account flow (14-day invitation token emailed below).
  let ownerUserId: string | undefined = callerUserId;
  let shellUserCreated = false;
  if (!ownerUserId && ownerEmail) {
    const created = await ctx.internalAdapter.createUser({
      email: ownerEmail,
      name: ownerEmail.split("@")[0] ?? ownerEmail,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Parameters<typeof ctx.internalAdapter.createUser>[0]);
    ownerUserId =
      (created as unknown as { id?: string }).id ??
      (created as unknown as { user?: { id: string } }).user?.id;
    shellUserCreated = true;
  }
  if (!ownerUserId) {
    return NextResponse.json(
      { error: `owner not found (ownerId=${ownerId ?? ""} ownerEmail=${ownerEmail ?? ""})` },
      { status: 404 },
    );
  }

  const org = await orgAdapter.createOrganization({
    organization: {
      name,
      slug,
      metadata: metadata ? (JSON.stringify(metadata) as unknown as string) : undefined,
      createdAt: new Date(),
    } as Parameters<typeof orgAdapter.createOrganization>[0]["organization"],
  });

  await orgAdapter.createMember({
    userId: ownerUserId,
    organizationId: org.id,
    role: "owner",
    createdAt: new Date(),
  } as Parameters<typeof orgAdapter.createMember>[0]);

  // Shell-user path: the owner did not exist before this call, so they have no
  // way to sign in. Create a 14-day Better Auth invitation row and email the
  // claim link. Failure to dispatch the email must NOT fail org creation —
  // the operator's saga treats org creation as authoritative; the email is a
  // best-effort side channel. A separate `SendClaimInvitationIfShell` saga
  // step (and the SPIFFE-authenticated reissue endpoint below) can retry if
  // this send fails. We record every terminal outcome as an audit event so
  // ops can spot undelivered mail.
  let invitationSent = false;
  if (shellUserCreated && ownerEmail) {
    try {
      const invitation = await orgAdapter.createInvitation({
        invitation: {
          email: ownerEmail,
          role: "owner",
          organizationId: org.id,
          teamIds: [],
          status: "pending",
          expiresAt: new Date(Date.now() + CLAIM_TTL_MS),
        },
        user: {
          id: ownerUserId,
          email: ownerEmail,
        },
      } as unknown as Parameters<typeof orgAdapter.createInvitation>[0]);

      const claimUrl = buildClaimUrl(
        (invitation as unknown as { id: string }).id,
      );
      const msg = renderClaimEmail({
        email: ownerEmail,
        claimUrl,
        expiresInDays: 14,
        orgName: name,
        role: "owner",
        supportEmail: getSupportEmail(),
      });
      await getEmailProvider().send(msg);
      invitationSent = true;

      emitAuthAudit({
        action: "membership_added",
        outcome: "ok",
        userId: ownerUserId,
        targetTenant: slug,
        reason: "shell_user_created",
      });
    } catch (err) {
      // Invitation or email dispatch failed. Record the failure but do not
      // fail the CreateOrganization call — the saga step
      // SendClaimInvitationIfShell will retry via the reissue endpoint.
      const message = err instanceof Error ? err.message : String(err);
      emitAuthAudit({
        action: "membership_added",
        outcome: "failed",
        userId: ownerUserId,
        targetTenant: slug,
        reason: "shell_user_created",
        errorMessage: message,
      });
    }
  }

  // Return shell-user bookkeeping so the operator's saga can decide whether
  // to run SendClaimInvitationIfShell. Both fields default to false so older
  // operator builds that ignore them still work.
  return NextResponse.json({
    id: org.id,
    shellUserCreated,
    invitationSent,
  });
}

/**
 * Reissue a claim invitation for a shell user. Called by the operator's
 * `SendClaimInvitationIfShell` saga step when the original email never
 * dispatched, or when an admin asks support to resend a link because the
 * previous one expired.
 *
 * SPIFFE-authenticated only — exposing a self-serve reissue endpoint would
 * invite spam (an attacker with the email could make Gibson send unlimited
 * "claim this account" mail). Admin-driven reissue keeps the SPIFFE boundary
 * as the sole gate.
 *
 * Semantics:
 *   1. Cancel every pending invitation for (email, organizationId) — avoids
 *      two valid tokens coexisting.
 *   2. Create a fresh invitation row with a new 14-day expiry.
 *   3. Re-render the claim email and dispatch through the configured provider.
 *   4. Emit audit.
 *
 * Body:    { organizationId: string, userEmail: string }
 * Returns: 200 { ok: true, expiresAt: string }
 *          | 400 { error: "..." }    — missing input
 *          | 401 { error: "..." }    — SPIFFE failed
 *          | 404 { error: "..." }    — org doesn't exist
 */
export async function handleReissueInvitation(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const body = (await req.json().catch(() => null)) as {
    organizationId?: string;
    userEmail?: string;
  } | null;
  if (!body?.organizationId || !body?.userEmail) {
    return NextResponse.json(
      { error: "organizationId and userEmail are required" },
      { status: 400 },
    );
  }
  const { organizationId, userEmail } = body;

  const ctx = (await auth.$context) as unknown as AnyCtx;
  const orgAdapter = getOrgAdapter(ctx);

  // Resolve the org — we need its name for the email body and its very
  // existence for the 404 case.
  const org = (await orgAdapter.findOrganizationById(organizationId)) as
    | { id: string; name: string; slug?: string }
    | null;
  if (!org) {
    return NextResponse.json(
      { error: "organization not found" },
      { status: 404 },
    );
  }

  // Look up the user so we can both pass `user` to createInvitation and record
  // a stable userId in the audit event. If the user is missing we still allow
  // the reissue — the caller's email is authoritative.
  const userRec = await ctx.internalAdapter.findUserByEmail(userEmail);
  const resolvedUser =
    (userRec as unknown as { user?: { id: string; email: string } } | null)
      ?.user ??
    (userRec as unknown as { id?: string; email?: string } | null);
  const userId =
    resolvedUser && "id" in resolvedUser && resolvedUser.id
      ? String(resolvedUser.id)
      : "anonymous";

  // Cancel every still-pending invitation for this (email, org) pair. Better
  // Auth's adapter doesn't expose a bulk-cancel call, so we fetch and update
  // one at a time. The volume is low (ops would have to actively spam the
  // reissue endpoint to produce more than a handful here).
  try {
    const pending = await orgAdapter.findPendingInvitation({
      email: userEmail,
      organizationId,
    });
    const rows = Array.isArray(pending) ? pending : pending ? [pending] : [];
    for (const inv of rows) {
      const invId = (inv as unknown as { id?: string }).id;
      if (invId) {
        await orgAdapter.updateInvitation({
          invitationId: invId,
          status: "canceled",
        });
      }
    }
  } catch {
    // Non-fatal — worst case we leave a stale pending row. The new invitation
    // below will still work; the user picks the link from the freshest email.
  }

  // Create the fresh invitation with a 14-day expiry.
  const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);
  const invitation = (await orgAdapter.createInvitation({
    invitation: {
      email: userEmail,
      role: "owner",
      organizationId,
      teamIds: [],
      status: "pending",
      expiresAt,
    },
    user: {
      id: userId !== "anonymous" ? userId : organizationId,
      email: userEmail,
    },
  } as unknown as Parameters<typeof orgAdapter.createInvitation>[0])) as unknown as {
    id: string;
  };

  // Dispatch the claim email. Failures here bubble to the caller (operator)
  // so the saga can retry, unlike the handleCreate path which swallows them.
  const claimUrl = buildClaimUrl(invitation.id);
  const msg = renderClaimEmail({
    email: userEmail,
    claimUrl,
    expiresInDays: 14,
    orgName: org.name,
    role: "owner",
    supportEmail: getSupportEmail(),
  });
  try {
    await getEmailProvider().send(msg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emitAuthAudit({
      action: "membership_added",
      outcome: "failed",
      userId,
      targetTenant: org.slug ?? org.name,
      reason: "invitation_reissued",
      errorMessage: message,
    });
    return NextResponse.json(
      { error: "email dispatch failed", detail: message },
      { status: 502 },
    );
  }

  emitAuthAudit({
    action: "membership_added",
    outcome: "ok",
    userId,
    targetTenant: org.slug ?? org.name,
    reason: "invitation_reissued",
  });

  return NextResponse.json({ ok: true, expiresAt: expiresAt.toISOString() });
}

export async function handleGetBySlug(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }
  const ctx = (await auth.$context) as unknown as AnyCtx;
  const adapter = getOrgAdapter(ctx);
  const org = await adapter.findOrganizationBySlug(slug);
  if (!org) {
    return NextResponse.json({}, { status: 404 });
  }
  return NextResponse.json({ id: org.id });
}

export async function handleDelete(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const body = (await req.json().catch(() => null)) as {
    organizationId?: string;
  } | null;
  if (!body?.organizationId) {
    return NextResponse.json(
      { error: "organizationId required" },
      { status: 400 },
    );
  }
  const ctx = (await auth.$context) as unknown as AnyCtx;
  const adapter = getOrgAdapter(ctx);
  await adapter.deleteOrganization(body.organizationId);
  return NextResponse.json({ ok: true });
}

export async function handleAddMember(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const body = (await req.json().catch(() => null)) as {
    organizationId?: string;
    userId?: string;
    role?: string;
  } | null;
  if (!body?.organizationId || !body?.userId || !body?.role) {
    return NextResponse.json(
      { error: "organizationId, userId, and role are required" },
      { status: 400 },
    );
  }
  const ctx = (await auth.$context) as unknown as AnyCtx;
  const adapter = getOrgAdapter(ctx);
  await adapter.createMember({
    userId: body.userId,
    organizationId: body.organizationId,
    role: body.role,
    createdAt: new Date(),
  } as Parameters<typeof adapter.createMember>[0]);
  return NextResponse.json({ ok: true });
}

export async function handleRemoveMember(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const body = (await req.json().catch(() => null)) as {
    organizationId?: string;
    userId?: string;
  } | null;
  if (!body?.organizationId || !body?.userId) {
    return NextResponse.json(
      { error: "organizationId and userId are required" },
      { status: 400 },
    );
  }
  const ctx = (await auth.$context) as unknown as AnyCtx;
  const adapter = getOrgAdapter(ctx);
  // Find the member row matching the target user, then delete by member id.
  // The adapter exposes listMembers but not find-by-userId, so we list+filter.
  const list = await adapter.listMembers({
    organizationId: body.organizationId,
    limit: 200,
  } as Parameters<typeof adapter.listMembers>[0]);
  const row = Array.isArray(list)
    ? list.find((m) => (m as { userId?: string }).userId === body.userId)
    : undefined;
  if (!row) {
    return NextResponse.json({ ok: true }); // idempotent: already gone
  }
  await adapter.deleteMember({
    memberId: (row as { id: string }).id,
    organizationId: body.organizationId,
    userId: body.userId,
  });
  return NextResponse.json({ ok: true });
}

/**
 * List the members of an organization. Used by the tenant-operator's
 * orphan-user cleanup saga to capture the membership graph before the org
 * is deleted (and the member rows cascade away).
 *
 * Body: { organizationId: string }
 * Response: { members: [{ userId, role }, ...] }
 */
export async function handleListMembers(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const body = (await req.json().catch(() => null)) as {
    organizationId?: string;
  } | null;
  if (!body?.organizationId) {
    return NextResponse.json(
      { error: "organizationId required" },
      { status: 400 },
    );
  }
  const ctx = (await auth.$context) as unknown as AnyCtx;
  const adapter = getOrgAdapter(ctx);

  // Confirm the org exists so we can return 404 (rather than an empty list)
  // when the operator captures after a teardown that has already removed it.
  const org = await adapter.findOrganizationById(body.organizationId);
  if (!org) {
    return NextResponse.json({ error: "organization not found" }, { status: 404 });
  }

  const result = await adapter.listMembers({
    organizationId: body.organizationId,
    limit: 1000,
  } as Parameters<typeof adapter.listMembers>[0]);
  // Better Auth returns either an array or { members, total } depending on
  // version — normalise to a plain list.
  const rows = Array.isArray(result)
    ? (result as Array<{ userId?: string; role?: string }>)
    : ((result as { members?: Array<{ userId?: string; role?: string }> })
        ?.members ?? []);
  const members = rows.map((m) => ({
    userId: String(m.userId ?? ""),
    role: String(m.role ?? ""),
  }));
  return NextResponse.json({ members });
}

/**
 * List the IDs of organizations a user is currently a member of. Used by
 * the orphan-cleanup saga to count remaining memberships before deletion.
 *
 * Returns only organization IDs — no names, metadata, or roles — to avoid
 * leaking unrelated tenant information across the SPIFFE boundary.
 *
 * Body: { userId: string }
 * Response: { organizationIds: string[] }
 */
export async function handleListUserOrganizations(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const body = (await req.json().catch(() => null)) as {
    userId?: string;
  } | null;
  if (!body?.userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  const ctx = (await auth.$context) as unknown as AnyCtx;
  const user = await ctx.internalAdapter.findUserById(body.userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }
  const adapter = getOrgAdapter(ctx);
  const orgs = (await adapter.listOrganizations(body.userId)) as Array<{
    id?: string;
  }>;
  const organizationIds = orgs
    .map((o) => String(o?.id ?? ""))
    .filter((id) => id.length > 0);
  return NextResponse.json({ organizationIds });
}

/**
 * Hard-delete a user. Defense-in-depth: re-checks the user's membership
 * count server-side and refuses (409) if non-zero, regardless of what the
 * caller believed. This prevents a buggy operator from removing a user who
 * still belongs to other tenants.
 *
 * Better Auth's internalAdapter.deleteUser cascades to session and account
 * rows. The `member` row has FK ON DELETE CASCADE on the dashboard's user
 * table, so any stale membership row would also be removed — but the 409
 * check above means in practice we only hit deleteUser when there are none.
 *
 * Body: { userId: string }
 * Response: 200 { ok: true } | 404 { error } | 409 { error, remainingOrgCount }
 */
export async function handleDeleteUser(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const body = (await req.json().catch(() => null)) as {
    userId?: string;
  } | null;
  if (!body?.userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  const ctx = (await auth.$context) as unknown as AnyCtx;

  const user = await ctx.internalAdapter.findUserById(body.userId);
  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const adapter = getOrgAdapter(ctx);
  const orgs = (await adapter.listOrganizations(body.userId)) as Array<{
    id?: string;
  }>;
  if (orgs.length > 0) {
    return NextResponse.json(
      {
        error: "user has remaining memberships",
        remainingOrgCount: orgs.length,
      },
      { status: 409 },
    );
  }

  await ctx.internalAdapter.deleteUser(body.userId);
  return NextResponse.json({ ok: true });
}
