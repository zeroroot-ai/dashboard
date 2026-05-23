'use server';

import { randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';

import {
  applyTenantMember,
  deleteTenantMember,
  listTenantMembers,
  patchTenantMember,
  tenantNamespace,
} from '@/src/lib/k8s/tenants';
import { getTenantOwnerRef } from '@/src/lib/k8s/owner-ref';
import { MemberRole } from '@/src/lib/k8s/types';
import { K8sError } from '@/src/lib/k8s/errors';
import { emitCrdAuditFromGate } from '@/src/lib/audit/crd';

import { classifyK8sError, type ActionResult } from './types';
import { requireCrdSession, requireCrdSessionForSelfAction } from './_authz';
import {
  inviteMemberInput,
  acceptInvitationInput,
  revokeMemberInput,
  resendInvitationInput,
} from './schemas';

export async function inviteMemberAction(input: {
  tenantName: string;
  email: string;
  role: MemberRole;
}): Promise<ActionResult<{ memberName: string }>> {
  const inputKeys = Object.keys(input ?? {});
  const gate = await requireCrdSession<{ memberName: string }>({
    action: 'inviteMemberAction',
    permission: 'members:invite',
    tenantName: input?.tenantName,
    rateLimit: 'inviteMember',
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = inviteMemberInput.safeParse(input);
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'inviteMemberAction',
      outcome: 'bad_input',
      targetTenant: input?.tenantName ?? null,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  const ns = tenantNamespace(parsed.data.tenantName);
  const memberName = `invite-${randomUUID().slice(0, 8)}`;
  // Read the inviter's email from the server-side session — never from
  // client input. Empty string means the controller will fall back to a
  // generic placeholder.
  const inviterEmail =
    typeof gate.session?.user?.email === 'string' ? gate.session.user.email : '';
  try {
    const ownerRef = await getTenantOwnerRef(parsed.data.tenantName);
    await applyTenantMember(ns, memberName, {
      email: parsed.data.email,
      role: parsed.data.role,
      tenantRef: { name: parsed.data.tenantName },
      invitedByEmail: inviterEmail,
    }, ownerRef);
    revalidatePath(`/dashboard/settings/members`);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'inviteMemberAction',
      outcome: 'ok',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      resourceRef: memberName,
    });
    return { ok: true, data: { memberName } };
  } catch (e) {
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'inviteMemberAction',
      outcome: 'internal',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      errorCode: code,
      errorMessage: err.message,
    });
    return { ok: false, error: err.message, code };
  }
}

/**
 * An invitee accepts their own invitation. Uses the self-action gate —
 * the caller's session.user.id MUST equal input.userId. No permission
 * string: the ability to accept an invite is inherent to being that user.
 */
export async function acceptInvitationAction(input: {
  tenantName: string;
  memberName: string;
  userId: string;
}): Promise<ActionResult> {
  const inputKeys = Object.keys(input ?? {});
  const gate = await requireCrdSessionForSelfAction(
    'acceptInvitationAction',
    input?.userId ?? '',
    inputKeys,
  );
  if (!gate.ok) return gate.result;

  const parsed = acceptInvitationInput.safeParse(input);
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'acceptInvitationAction',
      outcome: 'bad_input',
      targetTenant: input?.tenantName ?? null,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  try {
    await patchTenantMember(tenantNamespace(parsed.data.tenantName), parsed.data.memberName, {
      spec: { acceptedByUserId: parsed.data.userId },
    });
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'acceptInvitationAction',
      outcome: 'ok',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      resourceRef: parsed.data.memberName,
    });
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'acceptInvitationAction',
      outcome: 'internal',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      errorCode: code,
      errorMessage: err.message,
    });
    return { ok: false, error: err.message, code };
  }
}

export async function revokeMemberAction(
  tenantName: string,
  memberName: string,
): Promise<ActionResult> {
  const inputKeys = ['tenantName', 'memberName'];
  const gate = await requireCrdSession({
    action: 'revokeMemberAction',
    permission: 'members:revoke',
    tenantName,
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = revokeMemberInput.safeParse({ tenantName, memberName });
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeMemberAction',
      outcome: 'bad_input',
      targetTenant: tenantName,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  // Safeguard: prevent removing the last active owner. This guard runs
  // before any mutation so it holds even if the client-side gate is bypassed.
  try {
    const allMembers = await listTenantMembers(tenantNamespace(parsed.data.tenantName));
    const activeOwners = allMembers.filter(
      (m) => m.spec.role === 'owner' && m.status?.phase === 'Active',
    );
    const targetMember = allMembers.find((m) => m.metadata.name === parsed.data.memberName);
    if (activeOwners.length === 1 && targetMember?.spec.role === 'owner') {
      emitCrdAuditFromGate({
        session: gate.session,
        userId: gate.userId,
        action: 'revokeMemberAction',
        outcome: 'bad_input',
        targetTenant: parsed.data.tenantName,
        inputKeys,
        errorCode: 'FORBIDDEN',
        errorMessage: 'Cannot remove the last owner of a workspace. Transfer ownership first.',
        resourceRef: parsed.data.memberName,
      });
      return {
        ok: false,
        error: 'Cannot remove the last owner of a workspace. Transfer ownership first.',
        code: 'FORBIDDEN',
      };
    }
  } catch (e) {
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeMemberAction',
      outcome: 'internal',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      errorCode: code,
      errorMessage: `last-owner check failed: ${err.message}`,
      resourceRef: parsed.data.memberName,
    });
    return { ok: false, error: err.message, code };
  }

  try {
    await deleteTenantMember(tenantNamespace(parsed.data.tenantName), parsed.data.memberName);
    revalidatePath(`/dashboard/settings/members`);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeMemberAction',
      outcome: 'ok',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      resourceRef: parsed.data.memberName,
    });
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeMemberAction',
      outcome: 'internal',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      errorCode: code,
      errorMessage: err.message,
    });
    return { ok: false, error: err.message, code };
  }
}

export async function resendInvitationAction(
  tenantName: string,
  memberName: string,
): Promise<ActionResult> {
  const inputKeys = ['tenantName', 'memberName'];
  const gate = await requireCrdSession({
    action: 'resendInvitationAction',
    permission: 'members:invite',
    tenantName,
    rateLimit: 'inviteMember',
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = resendInvitationInput.safeParse({ tenantName, memberName });
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'resendInvitationAction',
      outcome: 'bad_input',
      targetTenant: tenantName,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  try {
    await patchTenantMember(tenantNamespace(parsed.data.tenantName), parsed.data.memberName, {
      spec: { resendRequestedAt: new Date().toISOString() },
    });
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'resendInvitationAction',
      outcome: 'ok',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      resourceRef: parsed.data.memberName,
    });
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'resendInvitationAction',
      outcome: 'internal',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      errorCode: code,
      errorMessage: err.message,
    });
    return { ok: false, error: err.message, code };
  }
}
