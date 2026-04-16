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

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
}

/**
 * Create a new Tenant CRD. Operator takes over from there.
 */
export async function provisionTenantAction(input: {
  displayName: string;
  owner: string;
  tier?: TenantTier;
}): Promise<ActionResult<{ name: string; namespace: string }>> {
  const name = slugify(input.displayName);
  if (!name) {
    return { ok: false, error: 'Invalid display name', code: 'invalid_input' };
  }
  try {
    const t = await applyTenant(name, {
      displayName: input.displayName,
      owner: input.owner,
      tier: input.tier ?? 'free',
    });
    revalidatePath('/dashboard');
    return {
      ok: true,
      data: { name: t.metadata.name, namespace: tenantNamespace(t.metadata.name) },
    };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}

/**
 * Delete a Tenant CRD. Operator's finalizer runs the full 4-phase teardown.
 */
export async function deleteTenantAction(
  name: string,
  confirmationText: string,
): Promise<ActionResult> {
  if (confirmationText !== name) {
    return { ok: false, error: 'Confirmation did not match tenant name', code: 'confirmation_mismatch' };
  }
  try {
    await k8sDeleteTenant(name);
    revalidatePath('/dashboard');
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}

/**
 * Patch tenant tier or display name.
 */
export async function updateTenantAction(
  name: string,
  patch: { tier?: TenantTier; displayName?: string },
): Promise<ActionResult> {
  try {
    await patchTenant(name, { spec: patch });
    revalidatePath('/dashboard');
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}
