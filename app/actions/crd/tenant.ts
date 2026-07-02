'use server';

/**
 * Admin tenant-lifecycle Server Actions, backed by the daemon's
 * `gibson.tenant.v1.AdminTenantService` (gibson#964), NOT a direct Kubernetes
 * write. This is the capstone of dashboard#855: it removes the dashboard's last
 * Kubernetes consumer so the web tier holds zero cluster credentials.
 *
 *   provisionTenantAction , AdminTenantService.AdminProvisionTenant
 *   updateTenantAction    , AdminTenantService.AdminUpdateTenant
 *   deleteTenantAction    , AdminTenantService.AdminDeleteTenant
 *
 * Each RPC is OPERATOR-PULL (ADR-0023): the daemon RECORDS the admin's intent in
 * its platform Postgres (the tenant_admin_ops queue) and returns an `op_id`. The
 * tenant-operator , the sole Kubernetes actor , drains the queue and applies the
 * op to the Tenant CR asynchronously. So these actions return success on
 * ENQUEUE; the Tenant CR does not exist (provision) / is not yet patched
 * (update) / is not yet deleted (delete) the instant the action returns. The
 * admin tenant list reflects the change after the operator reconciles (the
 * existing list refresh / tenant-status mirror covers it). Callers must NOT
 * assume synchronous CR existence right after the action.
 *
 * Authorization is cross-tenant platform-admin only (platform_operator USER),
 * enforced both by `requireCrdSession`'s `requireCrossTenant` gate (client
 * mirror) and by ext-authz against the proto's
 * `(gibson.auth.v1.authz)` annotation (defense in depth). All daemon traffic
 * flows dashboard → Envoy (jwt_authn + ext_authz) → daemon via `userClient`;
 * the dashboard never opens a direct daemon channel.
 */

import { revalidatePath } from 'next/cache';

import { ConnectError, Code } from '@connectrpc/connect';

import { AdminTenantService } from '@/src/gen/gibson/tenant/v1/admin_tenant_pb';
import { userClient } from '@/src/lib/gibson-client';
import { emitCrdAuditFromGate } from '@/src/lib/audit/crd';

import { type ActionErrorCode, type ActionResult, type TenantTier } from './types';
import { requireCrdSession } from './_authz';
import {
  provisionTenantInput,
  deleteTenantInput,
  updateTenantInput,
} from './schemas';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
}

/** The operator-derived namespace for a tenant, mirroring `tenant-<name>`. */
function tenantNamespace(name: string): string {
  return `tenant-${name}`;
}

/** Map a daemon RPC error to the dashboard ActionResult error shape. */
function rpcError<T>(e: unknown): ActionResult<T> {
  if (e instanceof ConnectError) {
    let code: ActionErrorCode;
    switch (e.code) {
      case Code.PermissionDenied:
      case Code.Unauthenticated:
        code = 'FORBIDDEN';
        break;
      case Code.NotFound:
        code = 'NOT_FOUND';
        break;
      case Code.AlreadyExists:
        code = 'CONFLICT';
        break;
      case Code.InvalidArgument:
        code = 'BAD_INPUT';
        break;
      default:
        code = 'INTERNAL';
    }
    return { ok: false, error: e.message, code };
  }
  return { ok: false, error: e instanceof Error ? e.message : String(e), code: 'INTERNAL' };
}

/**
 * Record intent to create a new Tenant. Cross-tenant (platform-admin) only.
 *
 * Async (operator-pull): the daemon enqueues the provision and returns an
 * op_id; the tenant-operator creates the Tenant CR with spec
 * {displayName, owner, tier}. The returned `name`/`namespace` are derived from
 * the slug (the same values the operator will use as `metadata.name` /
 * `tenant-<name>`); the CR itself appears after the operator reconciles.
 */
export async function provisionTenantAction(input: {
  displayName: string;
  owner: string;
  tier?: TenantTier;
}): Promise<ActionResult<{ name: string; namespace: string; opId: string }>> {
  const inputKeys = Object.keys(input ?? {});
  const gate = await requireCrdSession<{ name: string; namespace: string; opId: string }>({
    action: 'provisionTenantAction',
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = provisionTenantInput.safeParse(input);
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'provisionTenantAction',
      outcome: 'bad_input',
      targetTenant: null,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  const name = slugify(parsed.data.displayName);
  if (!name) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'provisionTenantAction',
      outcome: 'bad_input',
      targetTenant: null,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: 'Invalid display name',
    });
    return { ok: false, error: 'Invalid display name', code: 'BAD_INPUT' };
  }

  try {
    const client = userClient(AdminTenantService);
    const resp = await client.adminProvisionTenant({
      tenantId: name,
      displayName: parsed.data.displayName,
      ownerEmail: parsed.data.owner,
      tier: parsed.data.tier ?? 'team',
    });
    revalidatePath('/dashboard');
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'provisionTenantAction',
      outcome: 'ok',
      targetTenant: name,
      inputKeys,
      resourceRef: resp.opId || name,
    });
    return {
      ok: true,
      data: { name, namespace: tenantNamespace(name), opId: resp.opId },
    };
  } catch (e) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'provisionTenantAction',
      outcome: 'internal',
      targetTenant: name,
      inputKeys,
      errorCode: e instanceof ConnectError ? String(e.code) : 'INTERNAL',
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return rpcError(e);
  }
}

/**
 * Record intent to delete a Tenant. The operator deletes the Tenant CR, whose
 * finalizer runs the full 4-phase teardown; the daemon deletes no tenant data
 * itself. Async (operator-pull): returns success on enqueue.
 */
export async function deleteTenantAction(
  name: string,
  confirmationText: string,
): Promise<ActionResult> {
  const inputKeys = ['name', 'confirmationText'];
  const gate = await requireCrdSession({
    action: 'deleteTenantAction',
    tenantName: name,
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = deleteTenantInput.safeParse({ name, confirmationText });
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'deleteTenantAction',
      outcome: 'bad_input',
      targetTenant: name,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  try {
    const client = userClient(AdminTenantService);
    await client.adminDeleteTenant({ tenantId: name });
    revalidatePath('/dashboard');
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'deleteTenantAction',
      outcome: 'ok',
      targetTenant: name,
      inputKeys,
      resourceRef: name,
    });
    return { ok: true, data: undefined };
  } catch (e) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'deleteTenantAction',
      outcome: 'internal',
      targetTenant: name,
      inputKeys,
      errorCode: e instanceof ConnectError ? String(e.code) : 'INTERNAL',
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return rpcError(e);
  }
}

/**
 * Record intent to patch a tenant's tier and/or display name. Only the fields
 * present in `patch` are sent (via the request's `*_set` flags); unset fields
 * are left untouched by the operator. Async (operator-pull): returns success on
 * enqueue.
 */
export async function updateTenantAction(
  name: string,
  patch: { tier?: TenantTier; displayName?: string },
): Promise<ActionResult> {
  const inputKeys = ['name', 'patch'];
  const gate = await requireCrdSession({
    action: 'updateTenantAction',
    tenantName: name,
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = updateTenantInput.safeParse({ name, patch });
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'updateTenantAction',
      outcome: 'bad_input',
      targetTenant: name,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  const tierSet = parsed.data.patch.tier !== undefined;
  const displayNameSet = parsed.data.patch.displayName !== undefined;

  try {
    const client = userClient(AdminTenantService);
    await client.adminUpdateTenant({
      tenantId: name,
      // Send only the fields the patch marks set; the *_set flags tell the
      // operator which Tenant.spec fields to apply (vs. leave untouched).
      tier: parsed.data.patch.tier ?? '',
      tierSet,
      displayName: parsed.data.patch.displayName ?? '',
      displayNameSet,
    });
    revalidatePath('/dashboard');
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'updateTenantAction',
      outcome: 'ok',
      targetTenant: name,
      inputKeys,
      resourceRef: name,
    });
    return { ok: true, data: undefined };
  } catch (e) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'updateTenantAction',
      outcome: 'internal',
      targetTenant: name,
      inputKeys,
      errorCode: e instanceof ConnectError ? String(e.code) : 'INTERNAL',
      errorMessage: e instanceof Error ? e.message : String(e),
    });
    return rpcError(e);
  }
}
