'use server';

import { revalidatePath } from 'next/cache';

import {
  applyAgentEnrollment,
  deleteAgentEnrollment,
  getAgentEnrollment,
  getBootstrapToken,
  tenantNamespace,
} from '@/src/lib/k8s/tenants';
import {
  AgentMode,
  ComponentRef,
} from '@/src/lib/k8s/types';
import { K8sError } from '@/src/lib/k8s/errors';

import type { ActionResult } from './tenant';

export async function createEnrollmentAction(input: {
  tenantName: string;
  name: string;
  agentName: string;
  mode: AgentMode;
  componentGrants?: ComponentRef[];
  notes?: string;
}): Promise<ActionResult<{ name: string }>> {
  try {
    const ae = await applyAgentEnrollment(tenantNamespace(input.tenantName), input.name, {
      agentName: input.agentName,
      mode: input.mode,
      componentGrants: input.componentGrants,
      notes: input.notes,
    });
    revalidatePath(`/dashboard/agents`);
    return { ok: true, data: { name: ae.metadata.name } };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}

export async function revokeEnrollmentAction(
  tenantName: string,
  name: string,
): Promise<ActionResult> {
  try {
    await deleteAgentEnrollment(tenantNamespace(tenantName), name);
    revalidatePath(`/dashboard/agents`);
    return { ok: true, data: undefined };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}

/**
 * Fetch the bootstrap token Secret. This is a one-shot — the Secret is
 * automatically deleted by the operator when the agent registers.
 */
export async function fetchBootstrapTokenAction(
  tenantName: string,
  name: string,
): Promise<ActionResult<{ token: string; platformUrl: string }>> {
  try {
    const ae = await getAgentEnrollment(tenantNamespace(tenantName), name);
    if (!ae.status?.bootstrapSecretRef) {
      return { ok: false, error: 'Bootstrap not yet ready or already consumed', code: 'not_ready' };
    }
    const secret = await getBootstrapToken(
      tenantNamespace(tenantName),
      ae.status.bootstrapSecretRef,
    );
    if (!secret) {
      return { ok: false, error: 'Secret empty', code: 'empty_secret' };
    }
    return { ok: true, data: secret };
  } catch (e) {
    const err = e as K8sError;
    return { ok: false, error: err.message, code: err.name };
  }
}
