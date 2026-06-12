'use server';

/**
 * grant.ts, catalog-enablement server actions.
 *
 * Replaces the previous ComponentGrant CRD write (applyComponentGrant →
 * k8s().apply) with a daemon RPC call to MembershipService.SetCatalogEnabled
 * (ADR-0041 remaining gap). All backing-store access now routes through the
 * daemon via Envoy + ext-authz; the dashboard no longer writes ComponentGrant
 * CRDs directly to Kubernetes.
 *
 * Auth: requireActiveTenant() for active-tenant resolution; requireCrdSession
 * enforces the admin relation (defined in CRD_PERMISSIONS as { relation: "admin" }).
 */

import { revalidatePath } from 'next/cache';

import { MembershipService } from '@/src/gen/gibson/tenant/v1/membership_pb';
import { userClient } from '@/src/lib/gibson-client';
import {
  requireActiveTenant,
  NoActiveTenantError,
  StaleActiveTenantError,
} from '@/src/lib/auth/active-tenant';
import { emitCrdAuditFromGate } from '@/src/lib/audit/crd';
import type { ActionResult } from './types';
import { requireCrdSession } from './_authz';
import { grantComponentInput, revokeGrantInput, componentRefSchema } from './schemas';
import type { z } from 'zod';

/** ComponentRef is the domain type for a {kind, name} component reference. */
type ComponentRef = z.infer<typeof componentRefSchema>;

function componentKey(ref: ComponentRef): string {
  return `${ref.kind}-${ref.name}`;
}

export async function grantComponentAction(input: {
  tenantName: string;
  componentRef: ComponentRef;
  source?: 'admin' | 'tenant';
}): Promise<ActionResult<{ name: string }>> {
  const inputKeys = Object.keys(input ?? {});
  const gate = await requireCrdSession<{ name: string }>({
    action: 'grantComponentAction',
    tenantName: input?.tenantName,
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = grantComponentInput.safeParse(input);
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'grantComponentAction',
      outcome: 'bad_input',
      targetTenant: input?.tenantName ?? null,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  let activeTenantId: string;
  try {
    activeTenantId = await requireActiveTenant();
  } catch (err) {
    if (err instanceof NoActiveTenantError || err instanceof StaleActiveTenantError) {
      return { ok: false, error: 'No active tenant.', code: 'FORBIDDEN' };
    }
    throw err;
  }

  const ref = parsed.data.componentRef;
  const key = componentKey(ref);

  try {
    const client = userClient(MembershipService);
    await client.setCatalogEnabled({
      componentRef: key,
      enabled: true,
    });
    revalidatePath(`/dashboard/tools`);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'grantComponentAction',
      outcome: 'ok',
      targetTenant: activeTenantId,
      inputKeys,
      resourceRef: key,
    });
    return { ok: true, data: { name: key } };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'grantComponentAction',
      outcome: 'internal',
      targetTenant: activeTenantId,
      inputKeys,
      errorCode: 'INTERNAL',
      errorMessage: errMsg,
    });
    return { ok: false, error: errMsg, code: 'INTERNAL' };
  }
}

export async function revokeGrantAction(
  tenantName: string,
  componentRef: ComponentRef,
): Promise<ActionResult> {
  const inputKeys = ['tenantName', 'componentRef'];
  const gate = await requireCrdSession({
    action: 'revokeGrantAction',
    tenantName,
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = revokeGrantInput.safeParse({ tenantName, componentRef });
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeGrantAction',
      outcome: 'bad_input',
      targetTenant: tenantName,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  let activeTenantId: string;
  try {
    activeTenantId = await requireActiveTenant();
  } catch (err) {
    if (err instanceof NoActiveTenantError || err instanceof StaleActiveTenantError) {
      return { ok: false, error: 'No active tenant.', code: 'FORBIDDEN' };
    }
    throw err;
  }

  const ref = parsed.data.componentRef;
  const key = componentKey(ref);

  try {
    const client = userClient(MembershipService);
    await client.setCatalogEnabled({
      componentRef: key,
      enabled: false,
    });
    revalidatePath(`/dashboard/tools`);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeGrantAction',
      outcome: 'ok',
      targetTenant: activeTenantId,
      inputKeys,
      resourceRef: key,
    });
    return { ok: true, data: undefined };
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeGrantAction',
      outcome: 'internal',
      targetTenant: activeTenantId,
      inputKeys,
      errorCode: 'INTERNAL',
      errorMessage: errMsg,
    });
    return { ok: false, error: errMsg, code: 'INTERNAL' };
  }
}
