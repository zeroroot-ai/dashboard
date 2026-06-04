/**
 * High-level helpers for Gibson CRDs via K8s API.
 */

import 'server-only';

import { k8s } from './client';
import { getCorrelationId } from '@/src/lib/correlation';
import {
  Tenant,
  TenantMember,
  TenantSpec,
  TenantMemberSpec,
} from './types';
import type { K8sOwnerReference } from './owner-ref';

/** Annotation key used by the tenant-operator to correlate API calls end-to-end. */
const ANNOTATION_CORRELATION_ID = 'gibson.zeroroot.ai/correlation-id';

export async function applyTenant(name: string, spec: TenantSpec): Promise<Tenant> {
  return k8s().apply<Tenant>(
    {
      apiVersion: 'gibson.zeroroot.ai/v1alpha1',
      kind: 'Tenant',
      metadata: {
        name,
        annotations: {
          [ANNOTATION_CORRELATION_ID]: getCorrelationId(),
        },
      },
      spec,
    } as Tenant,
    true,
  );
}

export async function getTenant(name: string): Promise<Tenant> {
  return k8s().get<Tenant>('Tenant', name);
}

export async function deleteTenant(name: string): Promise<void> {
  return k8s().delete('Tenant', name);
}

export async function patchTenant(name: string, patch: object): Promise<Tenant> {
  return k8s().patch<Tenant>('Tenant', name, patch);
}

// ---- TenantMember ----

export async function applyTenantMember(
  namespace: string,
  name: string,
  spec: TenantMemberSpec,
  ownerRef?: K8sOwnerReference | null,
): Promise<TenantMember> {
  const metadata: TenantMember['metadata'] = { name, namespace };
  if (ownerRef) metadata.ownerReferences = [ownerRef];
  return k8s().apply<TenantMember>(
    {
      apiVersion: 'gibson.zeroroot.ai/v1alpha1',
      kind: 'TenantMember',
      metadata,
      spec,
    } as TenantMember,
    false,
  );
}

export async function listTenantMembers(namespace: string): Promise<TenantMember[]> {
  return k8s().list<TenantMember>('TenantMember', namespace);
}

export async function deleteTenantMember(namespace: string, name: string): Promise<void> {
  return k8s().delete('TenantMember', name, namespace);
}

export async function patchTenantMember(
  namespace: string,
  name: string,
  patch: object,
): Promise<TenantMember> {
  return k8s().patch<TenantMember>('TenantMember', name, patch, namespace);
}

// AgentEnrollment helpers were removed (dashboard#713): enrollment now mints
// credentials via gibson.tenant.v1.AgentIdentityService (the daemon owns the
// IdP + FGA writes, no CRD, no bootstrap-token Secret) — see
// app/api/agents/register/route.ts. Per ADR-0044, enrollment is not a
// Kubernetes operation.

// ---- utilities ----

export function tenantNamespace(name: string): string {
  return `tenant-${name}`;
}
