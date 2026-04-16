'use server';

import { revalidatePath } from 'next/cache';

import {
  applyAgentEnrollment,
  deleteAgentEnrollment,
  getAgentEnrollment,
  getBootstrapToken,
  tenantNamespace,
} from '@/src/lib/k8s/tenants';
import { getTenantOwnerRef } from '@/src/lib/k8s/owner-ref';
import {
  AgentMode,
  ComponentRef,
} from '@/src/lib/k8s/types';
import { K8sError } from '@/src/lib/k8s/errors';
import { emitCrdAuditFromGate } from '@/src/lib/audit/crd';

import { classifyK8sError, type ActionResult } from './types';
import { requireCrdSession } from './_authz';
import {
  createEnrollmentInput,
  revokeEnrollmentInput,
  fetchBootstrapTokenInput,
} from './schemas';

export async function createEnrollmentAction(input: {
  tenantName: string;
  name: string;
  agentName: string;
  mode: AgentMode;
  componentGrants?: ComponentRef[];
  notes?: string;
}): Promise<ActionResult<{ name: string }>> {
  const inputKeys = Object.keys(input ?? {});
  const gate = await requireCrdSession<{ name: string }>({
    action: 'createEnrollmentAction',
    permission: 'enrollments:create',
    tenantName: input?.tenantName,
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = createEnrollmentInput.safeParse(input);
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'createEnrollmentAction',
      outcome: 'bad_input',
      targetTenant: input?.tenantName ?? null,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  try {
    const ownerRef = await getTenantOwnerRef(parsed.data.tenantName);
    const ae = await applyAgentEnrollment(
      tenantNamespace(parsed.data.tenantName),
      parsed.data.name,
      {
        agentName: parsed.data.agentName,
        mode: parsed.data.mode,
        componentGrants: parsed.data.componentGrants,
        notes: parsed.data.notes,
      },
      ownerRef,
    );
    revalidatePath(`/dashboard/agents`);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'createEnrollmentAction',
      outcome: 'ok',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      resourceRef: ae.metadata.name,
    });
    return { ok: true, data: { name: ae.metadata.name } };
  } catch (e) {
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'createEnrollmentAction',
      outcome: 'internal',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      errorCode: code,
      errorMessage: err.message,
    });
    return { ok: false, error: err.message, code };
  }
}

export async function revokeEnrollmentAction(
  tenantName: string,
  name: string,
): Promise<ActionResult> {
  const inputKeys = ['tenantName', 'name'];
  const gate = await requireCrdSession({
    action: 'revokeEnrollmentAction',
    permission: 'enrollments:delete',
    tenantName,
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = revokeEnrollmentInput.safeParse({ tenantName, name });
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeEnrollmentAction',
      outcome: 'bad_input',
      targetTenant: tenantName,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  try {
    await deleteAgentEnrollment(tenantNamespace(parsed.data.tenantName), parsed.data.name);
    revalidatePath(`/dashboard/agents`);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeEnrollmentAction',
      outcome: 'ok',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      resourceRef: parsed.data.name,
    });
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'revokeEnrollmentAction',
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
 * Fetch the bootstrap token Secret — one-shot; the operator deletes the
 * Secret when the agent registers. SECURITY: The token value MUST NOT be
 * logged in any audit field; only `bootstrapSecretRef` and the outcome
 * are recorded.
 *
 * Rate-limit preset `fetchBootstrapToken` is fail-closed — a Redis outage
 * returns RATE_LIMITED rather than allowing enumeration.
 */
export async function fetchBootstrapTokenAction(
  tenantName: string,
  name: string,
): Promise<ActionResult<{ token: string; platformUrl: string }>> {
  const inputKeys = ['tenantName', 'name'];
  const gate = await requireCrdSession<{ token: string; platformUrl: string }>({
    action: 'fetchBootstrapTokenAction',
    permission: 'enrollments:read_bootstrap',
    tenantName,
    rateLimit: 'fetchBootstrapToken',
    inputKeys,
  });
  if (!gate.ok) return gate.result;

  const parsed = fetchBootstrapTokenInput.safeParse({ tenantName, name });
  if (!parsed.success) {
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'fetchBootstrapTokenAction',
      outcome: 'bad_input',
      targetTenant: tenantName,
      inputKeys,
      errorCode: 'BAD_INPUT',
      errorMessage: parsed.error.issues[0]?.message,
    });
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input', code: 'BAD_INPUT' };
  }

  try {
    const ae = await getAgentEnrollment(
      tenantNamespace(parsed.data.tenantName),
      parsed.data.name,
    );
    if (!ae.status?.bootstrapSecretRef) {
      emitCrdAuditFromGate({
        session: gate.session,
        userId: gate.userId,
        action: 'fetchBootstrapTokenAction',
        outcome: 'internal',
        targetTenant: parsed.data.tenantName,
        inputKeys,
        errorCode: 'NOT_FOUND',
        errorMessage: 'bootstrap not ready or consumed',
      });
      return { ok: false, error: 'Bootstrap not yet ready or already consumed', code: 'NOT_FOUND' };
    }
    const secret = await getBootstrapToken(
      tenantNamespace(parsed.data.tenantName),
      ae.status.bootstrapSecretRef,
    );
    if (!secret) {
      emitCrdAuditFromGate({
        session: gate.session,
        userId: gate.userId,
        action: 'fetchBootstrapTokenAction',
        outcome: 'internal',
        targetTenant: parsed.data.tenantName,
        inputKeys,
        errorCode: 'NOT_FOUND',
        errorMessage: 'secret empty',
      });
      return { ok: false, error: 'Secret empty', code: 'NOT_FOUND' };
    }
    // Success: audit records the secretRef, never the token.
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'fetchBootstrapTokenAction',
      outcome: 'ok',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      resourceRef: ae.status.bootstrapSecretRef,
    });
    return { ok: true, data: secret };
  } catch (e) {
    const err = e as K8sError;
    const code = classifyK8sError(err);
    emitCrdAuditFromGate({
      session: gate.session,
      userId: gate.userId,
      action: 'fetchBootstrapTokenAction',
      outcome: 'internal',
      targetTenant: parsed.data.tenantName,
      inputKeys,
      errorCode: code,
      errorMessage: err.message,
    });
    return { ok: false, error: err.message, code };
  }
}
