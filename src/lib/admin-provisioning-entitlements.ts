/**
 * Dashboard-side handlers for the entitlements provisioning routes called
 * by the tenant-operator (Zitadel JWT authenticated) during every
 * Tenant CR reconcile. Forwards to the gibson daemon's PlatformOperatorService
 * entitlement RPCs via the existing gRPC client transport.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 26.
 * Migration: admin-services-completion task 16 — switched from DaemonAdminService
 * to PlatformOperatorService per the service-split architecture.
 * Auth migration: service-acting-auth task 9 — replaced verifySpiffeBearer with
 * verifyZitadelBearer.
 * Authz: dashboard-authz-ui-gating Task 10 — second-pass assertAuthorizedService
 * check after verifyZitadelBearer validates the JWT. Verifies the registry entry
 * (if present) permits the SERVICE identity class.
 */
import { NextRequest, NextResponse } from "next/server";
import { PlatformOperatorService } from "@/src/gen/gibson/platform/v1/platform_operator_pb";
import { verifyZitadelBearer, ZitadelBearerError } from "@/src/lib/auth/zitadel-bearer-verifier";
import { serviceClient } from "@/src/lib/gibson-client";
import { AuthRegistry, IdentityClass } from "@/src/gen/authz/registry";

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
    return { ok: false, status: 401, body: { error: `zitadel auth failed: ${msg}`, code } };
  }
}

/**
 * Second-pass registry check for service-identity callers (the tenant-operator).
 *
 * If the method is present in the registry, verifies that its allowedIdentities
 * bitmap includes SERVICE or PLATFORM_OPERATOR. If the method is absent from
 * the registry, allows (unknown methods are not blocked — the daemon enforces
 * its own policy).
 *
 * This is defense-in-depth. `verifyZitadelBearer` is the primary gate.
 */
function assertAuthorizedService(method: string): void {
  const entry = AuthRegistry[method];
  if (!entry) return; // Unknown method — allow.
  const allowed =
    (entry.allowedIdentities & IdentityClass.SERVICE) !== 0 ||
    (entry.allowedIdentities & IdentityClass.PLATFORM_OPERATOR) !== 0;
  if (!allowed) {
    throw new Error(
      `service identity not permitted for ${method}: allowedIdentities=${entry.allowedIdentities}`,
    );
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
  try {
    assertAuthorizedService("/gibson.platform.v1.PlatformOperatorService/UpsertTenantQuota");
  } catch {
    return NextResponse.json({ error: "service identity not permitted" }, { status: 403 });
  }

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

  const client = serviceClient(PlatformOperatorService, body.tenant_id);
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
  try {
    assertAuthorizedService("/gibson.platform.v1.PlatformOperatorService/ListFeatureTuples");
  } catch {
    return NextResponse.json({ error: "service identity not permitted" }, { status: 403 });
  }

  const body = await parseBody<{ tenant_id?: string }>(req);
  if ("error" in body) return NextResponse.json({ error: body.error }, { status: body.status });
  if (!body.tenant_id) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });

  const client = serviceClient(PlatformOperatorService, body.tenant_id);
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
  try {
    assertAuthorizedService("/gibson.platform.v1.PlatformOperatorService/WriteAccessTuples");
  } catch {
    return NextResponse.json({ error: "service identity not permitted" }, { status: 403 });
  }

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

  // Cross-tenant write — entitlement reconciles touch tuples spanning
  // many tenants in a single batch. Use the system_tenant scope so the
  // daemon FGA path applies the platform-operator policy.
  const client = serviceClient(PlatformOperatorService, "_system");
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

export async function handleEmitSummary(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  try {
    assertAuthorizedService("/gibson.platform.v1.PlatformOperatorService/EmitAuditEvent");
  } catch {
    return NextResponse.json({ error: "service identity not permitted" }, { status: 403 });
  }

  const body = await parseBody<{
    tenant_id?: string;
    plan?: string;
    added_feature_tuples?: number;
    removed_feature_tuples?: number;
    quota_delta?: number;
    duration_ms?: number;
    trigger?: string;
  }>(req);
  if ("error" in body) return NextResponse.json({ error: body.error }, { status: body.status });
  if (!body.tenant_id) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });

  const fields: Record<string, string> = {
    plan: body.plan ?? "",
    added_feature_tuples: String(body.added_feature_tuples ?? 0),
    removed_feature_tuples: String(body.removed_feature_tuples ?? 0),
    quota_delta: String(body.quota_delta ?? 0),
    duration_ms: String(body.duration_ms ?? 0),
    trigger: body.trigger ?? "background",
  };

  const client = serviceClient(PlatformOperatorService, body.tenant_id);
  try {
    await client.emitAuditEvent({
      event: {
        $typeName: "gibson.platform.v1.AuditEventMessage",
        type: "entitlements_reconcile",
        actorSubject: a.subject,
        actorSource: "operator",
        tuple: "",
        actionClass: "",
        scopeType: "tenant",
        operation: "",
        reason: "",
        timestamp: new Date().toISOString(),
        fields,
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: `daemon emitAuditEvent failed: ${String(err)}` },
      { status: 502 },
    );
  }
}

export async function handleSeedCatalog(req: NextRequest) {
  const a = await authz(req);
  if (!a.ok) return NextResponse.json(a.body, { status: a.status });
  try {
    assertAuthorizedService(
      "/gibson.platform.v1.PlatformOperatorService/SeedCatalogTenantEnabled",
    );
  } catch {
    return NextResponse.json({ error: "service identity not permitted" }, { status: 403 });
  }

  const body = await parseBody<{ tenant_id?: string }>(req);
  if ("error" in body) return NextResponse.json({ error: body.error }, { status: body.status });
  if (!body.tenant_id) return NextResponse.json({ error: "tenant_id required" }, { status: 400 });

  const client = serviceClient(PlatformOperatorService, body.tenant_id);
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
