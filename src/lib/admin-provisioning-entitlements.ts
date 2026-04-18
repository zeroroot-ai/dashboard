/**
 * Dashboard-side handlers for the entitlements provisioning routes called
 * by the tenant-operator (SPIFFE JWT-SVID authenticated) during every
 * Tenant CR reconcile. Forwards to the gibson daemon's DaemonAdminService
 * entitlement RPCs via the existing gRPC client transport.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 26.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySpiffeBearer } from "@/src/lib/spiffe-verifier";
import { getDaemonAdminClient } from "@/src/lib/gibson-admin-client";

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
    return { ok: false, status: 401, body: { error: `spiffe auth failed: ${msg}` } };
  }
}

async function parseBody<T>(req: NextRequest): Promise<T | { error: string; status: number }> {
  try {
    return (await req.json()) as T;
  } catch {
    return { error: "invalid JSON", status: 400 };
  }
}

export async function handleUpsertQuota(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const body = await parseBody<{
    tenant_id?: string;
    seats?: number;
    concurrent_agents?: number;
    storage_gb?: number;
    retention_days?: number;
    sandbox_launches_per_month?: number;
  }>(req);
  if ("error" in body) return NextResponse.json({ error: body.error }, { status: body.status });
  if (!body.tenant_id) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });

  const client = getDaemonAdminClient();
  try {
    const resp = await client.upsertTenantQuota({
      tenantId: body.tenant_id,
      seats: body.seats ?? 0,
      concurrentAgents: body.concurrent_agents ?? 0,
      storageGb: body.storage_gb ?? 0,
      retentionDays: body.retention_days ?? 0,
      sandboxLaunchesPerMonth: body.sandbox_launches_per_month ?? 0,
    });
    return NextResponse.json({ updated_at: resp.updatedAt });
  } catch (err) {
    return NextResponse.json(
      { error: `daemon upsertTenantQuota failed: ${String(err)}` },
      { status: 502 },
    );
  }
}

export async function handleListFeatureTuples(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const body = await parseBody<{ tenant_id?: string }>(req);
  if ("error" in body) return NextResponse.json({ error: body.error }, { status: body.status });
  if (!body.tenant_id) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });

  const client = getDaemonAdminClient();
  try {
    const resp = await client.listFeatureTuples({ tenantId: body.tenant_id });
    return NextResponse.json({ relations: resp.relations });
  } catch (err) {
    return NextResponse.json(
      { error: `daemon listFeatureTuples failed: ${String(err)}` },
      { status: 502 },
    );
  }
}

export async function handleWriteTuples(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const body = await parseBody<{
    add?: Array<{ user?: string; relation?: string; object?: string }>;
    delete?: Array<{ user?: string; relation?: string; object?: string }>;
    reason?: string;
  }>(req);
  if ("error" in body) return NextResponse.json({ error: body.error }, { status: body.status });

  const mapTuples = (
    ts?: Array<{ user?: string; relation?: string; object?: string }>,
  ) =>
    (ts ?? [])
      .filter((t) => t.user && t.relation && t.object)
      .map((t) => ({ user: t.user!, relation: t.relation!, object: t.object! }));

  const client = getDaemonAdminClient();
  try {
    const resp = await client.writeAccessTuples({
      add: mapTuples(body.add),
      delete: mapTuples(body.delete),
      reason: body.reason ?? "",
    });
    return NextResponse.json({ added: resp.added, deleted: resp.deleted });
  } catch (err) {
    return NextResponse.json(
      { error: `daemon writeAccessTuples failed: ${String(err)}` },
      { status: 502 },
    );
  }
}

export async function handleSeedCatalog(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });

  const body = await parseBody<{ tenant_id?: string }>(req);
  if ("error" in body) return NextResponse.json({ error: body.error }, { status: body.status });
  if (!body.tenant_id) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });

  const client = getDaemonAdminClient();
  try {
    const resp = await client.seedCatalogTenantEnabled({ tenantId: body.tenant_id });
    return NextResponse.json({ tuples_written: resp.tuplesWritten });
  } catch (err) {
    return NextResponse.json(
      { error: `daemon seedCatalogTenantEnabled failed: ${String(err)}` },
      { status: 502 },
    );
  }
}
