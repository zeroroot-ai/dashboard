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

  // Idempotency — return existing org if slug already claimed.
  const existing = await orgAdapter.findOrganizationBySlug(slug);
  if (existing) {
    return NextResponse.json({ id: existing.id });
  }

  // Resolve owner user.
  let ownerUserId: string | undefined;
  if (ownerId) {
    const u = await ctx.internalAdapter.findUserById(ownerId);
    if (u) ownerUserId = u.id;
  }
  if (!ownerUserId && ownerEmail) {
    const u = await ctx.internalAdapter.findUserByEmail(ownerEmail);
    // findUserByEmail returns { user, accounts } on hit
    const userRec =
      (u as unknown as { user?: { id: string } } | null)?.user ??
      (u as unknown as { id?: string } | null);
    if (userRec && "id" in userRec && userRec.id) {
      ownerUserId = userRec.id;
    }
  }
  // Auto-create the owner user if missing. Operator-driven provisioning must
  // work even when the tenant's owner hasn't signed up yet — for example,
  // admin-seeded tenants, CLI-provisioned workspaces, or tests. The account
  // is shell-only (no credentials); the owner completes sign-up later via the
  // normal Better Auth flow, at which point they already have an org waiting.
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

  return NextResponse.json({ id: org.id });
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
