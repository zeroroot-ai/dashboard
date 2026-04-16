'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';

import {
  applyTenantMember,
  deleteTenantMember,
  patchTenantMember,
  tenantNamespace,
} from '@/src/lib/k8s/tenants';
import { MemberRole } from '@/src/lib/k8s/types';
import { K8sError } from '@/src/lib/k8s/errors';

import type { ActionResult } from './tenant';

export async function inviteMemberAction(input: {
  tenantName: string;
  email: string;
  role: MemberRole;
}): Promise<ActionResult<{ memberName: string }>> {
  const ns = tenantNamespace(input.tenantName);
  const memberName = `invite-${randomUUID().slice(0, 8)}`;
  try {
    await applyTenantMember(ns, memberName, {
      email: input.email,
      role: input.role,
      tenantRef: { name: input.tenantName },
    });
    revalidatePath(`/dashboard/settings/members`);
    return { ok: true, data: { memberName } };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}

export async function acceptInvitationAction(input: {
  tenantName: string;
  memberName: string;
  userId: string;
}): Promise<ActionResult> {
  try {
    await patchTenantMember(tenantNamespace(input.tenantName), input.memberName, {
      spec: { acceptedByUserId: input.userId },
    });
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}

export async function revokeMemberAction(
  tenantName: string,
  memberName: string,
): Promise<ActionResult> {
  try {
    await deleteTenantMember(tenantNamespace(tenantName), memberName);
    revalidatePath(`/dashboard/settings/members`);
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}

export async function resendInvitationAction(
  tenantName: string,
  memberName: string,
): Promise<ActionResult> {
  try {
    await patchTenantMember(tenantNamespace(tenantName), memberName, {
      spec: { resendRequestedAt: new Date().toISOString() },
    });
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}
