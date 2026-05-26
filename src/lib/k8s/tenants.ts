/**
 * High-level helpers for Gibson CRDs via K8s API.
 */

import 'server-only';

import { k8s } from './client';
import { getCorrelationId } from '@/src/lib/correlation';
import {
  Tenant,
  TenantMember,
  AgentEnrollment,
  ComponentGrant,
  TenantSpec,
  TenantMemberSpec,
  AgentEnrollmentSpec,
  ComponentGrantSpec,
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

export async function listTenants(): Promise<Tenant[]> {
  return k8s().list<Tenant>('Tenant');
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

// ---- AgentEnrollment ----

export async function applyAgentEnrollment(
  namespace: string,
  name: string,
  spec: AgentEnrollmentSpec,
  ownerRef?: K8sOwnerReference | null,
): Promise<AgentEnrollment> {
  const metadata: AgentEnrollment['metadata'] = { name, namespace };
  if (ownerRef) metadata.ownerReferences = [ownerRef];
  return k8s().apply<AgentEnrollment>(
    {
      apiVersion: 'gibson.zeroroot.ai/v1alpha1',
      kind: 'AgentEnrollment',
      metadata,
      spec,
    } as AgentEnrollment,
    false,
  );
}

export async function listAgentEnrollments(namespace: string): Promise<AgentEnrollment[]> {
  return k8s().list<AgentEnrollment>('AgentEnrollment', namespace);
}

export async function getAgentEnrollment(
  namespace: string,
  name: string,
): Promise<AgentEnrollment> {
  return k8s().get<AgentEnrollment>('AgentEnrollment', name, namespace);
}

export async function deleteAgentEnrollment(
  namespace: string,
  name: string,
): Promise<void> {
  return k8s().delete('AgentEnrollment', name, namespace);
}

export async function getBootstrapToken(
  namespace: string,
  secretRef: string,
): Promise<{ token: string; platformUrl: string } | null> {
  const secret = await k8s().getSecret(namespace, secretRef);
  const data = secret.data;
  if (!data) return null;
  const decode = (v: string) => Buffer.from(v, 'base64').toString('utf-8');
  return {
    token: data.token ? decode(data.token) : '',
    platformUrl: data['platform-url'] ? decode(data['platform-url']) : '',
  };
}

// ---- ComponentGrant ----

export async function applyComponentGrant(
  namespace: string,
  name: string,
  spec: ComponentGrantSpec,
  ownerRef?: K8sOwnerReference | null,
): Promise<ComponentGrant> {
  const metadata: ComponentGrant['metadata'] = { name, namespace };
  if (ownerRef) metadata.ownerReferences = [ownerRef];
  return k8s().apply<ComponentGrant>(
    {
      apiVersion: 'gibson.zeroroot.ai/v1alpha1',
      kind: 'ComponentGrant',
      metadata,
      spec,
    } as ComponentGrant,
    false,
  );
}

export async function listComponentGrants(namespace: string): Promise<ComponentGrant[]> {
  return k8s().list<ComponentGrant>('ComponentGrant', namespace);
}

export async function deleteComponentGrant(
  namespace: string,
  name: string,
): Promise<void> {
  return k8s().delete('ComponentGrant', name, namespace);
}

// ---- utilities ----

export function tenantNamespace(name: string): string {
  return `tenant-${name}`;
}
