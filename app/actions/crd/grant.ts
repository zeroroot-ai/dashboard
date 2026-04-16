'use server';

import { revalidatePath } from 'next/cache';

import {
  applyComponentGrant,
  deleteComponentGrant,
  tenantNamespace,
} from '@/src/lib/k8s/tenants';
import { ComponentRef } from '@/src/lib/k8s/types';
import { K8sError } from '@/src/lib/k8s/errors';

import type { ActionResult } from './tenant';

function grantName(ref: ComponentRef): string {
  return `grant-${ref.kind}-${ref.name}`.slice(0, 63);
}

export async function grantComponentAction(input: {
  tenantName: string;
  componentRef: ComponentRef;
  source?: 'admin' | 'tenant';
}): Promise<ActionResult<{ name: string }>> {
  const name = grantName(input.componentRef);
  try {
    const cg = await applyComponentGrant(tenantNamespace(input.tenantName), name, {
      componentRef: input.componentRef,
      scope: 'tenant',
    });
    revalidatePath(`/dashboard/tools`);
    return { ok: true, data: { name: cg.metadata.name } };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}

export async function revokeGrantAction(
  tenantName: string,
  componentRef: ComponentRef,
): Promise<ActionResult> {
  try {
    await deleteComponentGrant(tenantNamespace(tenantName), grantName(componentRef));
    revalidatePath(`/dashboard/tools`);
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}
