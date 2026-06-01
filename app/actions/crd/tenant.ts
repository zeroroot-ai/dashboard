'use server';

import { revalidatePath } from 'next/cache';

import {
  applyTenant,
  deleteTenant as k8sDeleteTenant,
  patchTenant,
  tenantNamespace,
} from '@/src/lib/k8s/tenants';
import { TenantTier } from '@/src/lib/k8s/types';
import { K8sError } from '@/src/lib/k8s/errors';
import { emitCrdAuditFromGate } from '@/src/lib/audit/crd';

import { classifyK8sError, type ActionResult } from './types';
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

/**
 * Create a new Tenant CRD. Cross-tenant roles only.
 */
export async function provisionTenantAction(input: {
  displayName: string;
  owner: string;
  tier?: TenantTier;
}): Promise<ActionResult<{ name: string; namespace: string }>> {
  const inputKeys = Object.keys(input ?? {});
  const gate = await requireCrdSession<{ name: string; namespace: string }>({
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
    const t = await applyTenant(name, {
      displayName: parsed.data.displayName,
      owner: parsed.data.owner,
      tier: parsed.data.tier ?? 'team',
    });
    revalidatePath('/dashboard');
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'provisionTenantAction',
      outcome: 'ok',
      targetTenant: t.metadata.name,
      inputKeys,
      resourceRef: t.metadata.name,
    });
    return {
      ok: true,
      data: { name: t.metadata.name, namespace: tenantNamespace(t.metadata.name) },
    };
  } catch (e) {
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'provisionTenantAction',
      outcome: 'internal',
      targetTenant: name,
      inputKeys,
      errorCode: code,
      errorMessage: err.message,
    });
    return { ok: false, error: err.message, code };
  }
}

/**
 * Delete a Tenant CRD. Operator's finalizer runs the full 4-phase teardown.
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
    await k8sDeleteTenant(name);
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
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'deleteTenantAction',
      outcome: 'internal',
      targetTenant: name,
      inputKeys,
      errorCode: code,
      errorMessage: err.message,
    });
    return { ok: false, error: err.message, code };
  }
}

/**
 * Patch tenant tier or display name.
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

  try {
    await patchTenant(name, { spec: parsed.data.patch });
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
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'updateTenantAction',
      outcome: 'internal',
      targetTenant: name,
      inputKeys,
      errorCode: code,
      errorMessage: err.message,
    });
    return { ok: false, error: err.message, code };
  }
}
