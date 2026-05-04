/**
 * Zitadel-JWT-authenticated admin provisioning helpers.
 *
 * These are called by Next.js route handlers under /api/admin/provisioning/*
 * which are invoked by the tenant-operator via Zitadel JWT Bearer auth.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js — see task 24
 * implementation log. The previous implementation used Better Auth's org
 * adapter directly. With Auth.js v5 + Zitadel, tenant CRUD goes through
 * the Zitadel Management API (create org, create user, assign role). This
 * rewrite is scoped to the tenant-switcher / provisioning tasks (task 25+).
 * Until then, all endpoints return 503 to make failures explicit.
 *
 * Auth migration: service-acting-auth task 9 — replaced verifySpiffeBearer
 * with verifyZitadelBearer.
 *
 * Authz: dashboard-authz-ui-gating Task 10 — verifyZitadelBearer is the
 * primary gate; all business handlers are stubbed 503 so no second-pass check
 * is needed here (stub file). The entitlements forwarders previously lived
 * at admin-provisioning-entitlements.ts; deleted in spec
 * tenant-provisioning-unification-phase2 Phase 7.1 because the operator now
 * calls the daemon's PlatformOperatorService gRPC directly.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyZitadelBearer, ZitadelBearerError } from "@/src/lib/auth/zitadel-bearer-verifier";

async function authz(req: NextRequest): Promise<
  | { ok: true; subject: string }
  | { ok: false; status: number; body: { error: string; code?: string } }
> {
  try {
    const { subject } = await verifyZitadelBearer(
      req.headers.get("authorization"),
    );
    return { ok: true, subject };
  } catch (err) {
    const code = err instanceof ZitadelBearerError ? err.code : undefined;
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 401,
      body: { error: `service auth failed: ${msg}`, code },
    };
  }
}

function notImplemented() {
  return NextResponse.json(
    {
      error:
        "admin-provisioning endpoints are being migrated to the platform's identity-management API. " +
        "Retry after the tenant-operator is updated.",
    },
    { status: 503 },
  );
}

export async function handleCreate(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  return notImplemented();
}

export async function handleReissueInvitation(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  return notImplemented();
}

export async function handleGetBySlug(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  return notImplemented();
}

export async function handleDelete(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  return notImplemented();
}

export async function handleAddMember(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  return notImplemented();
}

export async function handleRemoveMember(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  return notImplemented();
}

export async function handleListMembers(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  return notImplemented();
}

export async function handleListUserOrganizations(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  return notImplemented();
}

export async function handleDeleteUser(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  return notImplemented();
}
