'use server';

import { revalidatePath } from 'next/cache';

import {
  applyComponentGrant,
  deleteComponentGrant,
  tenantNamespace,
} from '@/src/lib/k8s/tenants';
import { getTenantOwnerRef } from '@/src/lib/k8s/owner-ref';
import { ComponentRef } from '@/src/lib/k8s/types';
import { K8sError } from '@/src/lib/k8s/errors';
import { emitCrdAuditFromGate } from '@/src/lib/audit/crd';

import { classifyK8sError, type ActionResult } from './types';
import { requireCrdSession } from './_authz';
import { grantComponentInput, revokeGrantInput } from './schemas';

function grantName(ref: ComponentRef): string {
  return `grant-${ref.kind}-${ref.name}`.slice(0, 63);
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

  const name = grantName(parsed.data.componentRef);
  try {
    const ownerRef = await getTenantOwnerRef(parsed.data.tenantName);
    const cg = await applyComponentGrant(
      tenantNamespace(parsed.data.tenantName),
      name,
      { componentRef: parsed.data.componentRef, scope: 'tenant' },
      ownerRef,
    );
    revalidatePath(`/dashboard/tools`);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'grantComponentAction',
      outcome: 'ok',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      resourceRef: cg.metadata.name,
    });
    return { ok: true, data: { name: cg.metadata.name } };
  } catch (e) {
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'grantComponentAction',
      outcome: 'internal',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      errorCode: code,
      errorMessage: err.message,
    });
    return { ok: false, error: err.message, code };
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

  try {
    await deleteComponentGrant(
      tenantNamespace(parsed.data.tenantName),
      grantName(parsed.data.componentRef),
    );
    revalidatePath(`/dashboard/tools`);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeGrantAction',
      outcome: 'ok',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      resourceRef: grantName(parsed.data.componentRef),
    });
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeGrantAction',
      outcome: 'internal',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      errorCode: code,
      errorMessage: err.message,
    });
    return { ok: false, error: err.message, code };
  }
}
