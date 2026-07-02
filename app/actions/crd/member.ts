'use server';

/**
 * Member-management Server Actions, backed by the daemon's MembershipService
 * (gibson#621/#626), NOT the TenantMember CR. Per ADR-0043/0044 the daemon owns
 * the membership + invitation lifecycle; the dashboard is a pure client.
 *
 *   inviteMemberAction    , MembershipService.InviteMember (issues a pending
 *                            invitation + emails the accept link, gibson#632).
 *   revokeMemberAction    , active member  → SetTenantRole(remove)
 *                            pending invite  → CancelInvitation
 *   resendInvitationAction, MembershipService.ResendInvitation
 *   acceptInvitationAction, MembershipService.AcceptInvitation (token redeem)
 *
 * dashboard#715 ripped the TenantMember CR writes (applyTenantMember /
 * patchTenantMember / deleteTenantMember).
 */

import { ConnectError, Code } from '@connectrpc/connect';

import { MembershipService } from '@/src/gen/gibson/tenant/v1/membership_pb';
import { userClient, serviceClient } from '@/src/lib/gibson-client';
import {
  requireActiveTenant,
  NoActiveTenantError,
  StaleActiveTenantError,
} from '@/src/lib/auth/active-tenant';
import { emitCrdAuditFromGate } from '@/src/lib/audit/crd';
import { listMembersAction } from '@/app/actions/read/listMembers';

import { type ActionResult, type MemberRole } from './types';
import { requireCrdSession } from './_authz';
import {
  inviteMemberInput,
  acceptInvitationInput,
  revokeMemberInput,
  resendInvitationInput,
} from './schemas';

/** Map a daemon RPC error to the dashboard ActionResult error shape. */
function rpcError<T>(e: unknown): ActionResult<T> {
  if (e instanceof ConnectError) {
    const code = e.code === Code.PermissionDenied ? 'FORBIDDEN' : 'INTERNAL';
    return { ok: false, error: e.message, code };
  }
  return { ok: false, error: e instanceof Error ? e.message : String(e), code: 'INTERNAL' };
}

async function activeTenantOr<T>(): Promise<{ tenantId: string } | { result: ActionResult<T> }> {
  try {
    return { tenantId: await requireActiveTenant() };
  } catch (err) {
    if (err instanceof NoActiveTenantError || err instanceof StaleActiveTenantError) {
      return { result: { ok: false, error: 'No active tenant.', code: 'FORBIDDEN' } };
    }
    throw err;
  }
}

export async function inviteMemberAction(input: {
  tenantName: string;
  email: string;
  role: MemberRole;
}): Promise<ActionResult<{ invitationId: string }>> {
  const inputKeys = Object.keys(input ?? {});
  const gate = await requireCrdSession<{ invitationId: string }>({
    action: 'inviteMemberAction',
    tenantName: input?.tenantName,
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = inviteMemberInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  const t = await activeTenantOr<{ invitationId: string }>();
  if ('result' in t) return t.result;

  try {
    const client = userClient(MembershipService);
    const resp = await client.inviteMember({
      tenantId: t.tenantId,
      email: parsed.data.email,
      role: parsed.data.role,
    });
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'inviteMemberAction',
      outcome: 'ok',
      targetTenant: t.tenantId,
      inputKeys,
      resourceRef: resp.invitationId,
    });
    return { ok: true, data: { invitationId: resp.invitationId } };
  } catch (e) {
    return rpcError(e);
  }
}

/**
 * Redeem an invitation token. The token is the sole capability, the daemon's
 * AcceptInvitation is unauthenticated and provisions the invitee. Called from
 * the invitation accept page.
 */
// @crd-authz-exempt: token-based redemption, the invitation token is the sole capability; AcceptInvitation is unauthenticated by design (gibson#633, ADR-0043). No CRD mutation; routes through the daemon RPC.
export async function acceptInvitationAction(input: { token: string }): Promise<ActionResult> {
  const parsed = acceptInvitationInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }
  try {
    // serviceClient (dashboard SA), NOT userClient: the invitee is typically a
    // brand-new user with no session/token. The dashboard SA authenticates the
    // Envoy hop; the daemon's AcceptInvitation is unauthenticated:true so
    // ext-authz skips the FGA check and redeems by token (gibson#633,
    // dashboard#727). Empty tenant, the daemon derives it from the invitation.
    const client = serviceClient(MembershipService, '');
    await client.acceptInvitation({ token: parsed.data.token });
    return { ok: true, data: undefined };
  } catch (e) {
    return rpcError(e);
  }
}

/**
 * Remove a member or cancel a pending invitation. Active members are removed by
 * stripping their role tuples (SetTenantRole remove); pending invitations are
 * cancelled by email. The last active owner cannot be removed.
 */
export async function revokeMemberAction(input: {
  userId: string;
  email: string;
  status: string;
}): Promise<ActionResult> {
  const inputKeys = ['userId', 'email', 'status'];
  const gate = await requireCrdSession({ action: 'revokeMemberAction', inputKeys });
  if (!gate.ok) return gate.result;

  const parsed = revokeMemberInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  const t = await activeTenantOr<void>();
  if ('result' in t) return t.result;

  const isInvited = parsed.data.status === 'invited';

  // Last-owner safeguard for active members. Reads the daemon roster (source of
  // truth) so it holds even if the client gate is bypassed.
  if (!isInvited) {
    const roster = await listMembersAction();
    if (roster.ok) {
      const activeOwners = roster.data.filter((m) => m.role === 'owner' && m.status === 'active');
      const target = roster.data.find((m) => m.userId === parsed.data.userId);
      if (activeOwners.length === 1 && target?.role === 'owner') {
        return {
          ok: false,
          error: 'Cannot remove the last owner of a workspace. Transfer ownership first.',
          code: 'FORBIDDEN',
        };
      }
    }
  }

  try {
    const client = userClient(MembershipService);
    if (isInvited) {
      await client.cancelInvitation({ tenantId: t.tenantId, email: parsed.data.email });
    } else {
      await client.setTenantRole({ tenantId: t.tenantId, userId: parsed.data.userId, role: '', remove: true });
    }
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeMemberAction',
      outcome: 'ok',
      targetTenant: t.tenantId,
      inputKeys,
      resourceRef: parsed.data.userId || parsed.data.email,
    });
    return { ok: true, data: undefined };
  } catch (e) {
    return rpcError(e);
  }
}

export async function resendInvitationAction(input: { email: string }): Promise<ActionResult> {
  const inputKeys = ['email'];
  const gate = await requireCrdSession({ action: 'resendInvitationAction', inputKeys });
  if (!gate.ok) return gate.result;

  const parsed = resendInvitationInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  const t = await activeTenantOr<void>();
  if ('result' in t) return t.result;

  try {
    const client = userClient(MembershipService);
    await client.resendInvitation({ tenantId: t.tenantId, email: parsed.data.email });
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'resendInvitationAction',
      outcome: 'ok',
      targetTenant: t.tenantId,
      inputKeys,
      resourceRef: parsed.data.email,
    });
    return { ok: true, data: undefined };
  } catch (e) {
    return rpcError(e);
  }
}
