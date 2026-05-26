import 'server-only';

import { k8s } from './client';
import type { Tenant } from './types';

/**
 * Minimal Kubernetes OwnerReference type — matches metav1.OwnerReference
 * shape. Only includes fields the operator's mutating webhook + GC need.
 */
export interface K8sOwnerReference {
  apiVersion: string;
  kind: string;
  name: string;
  uid: string;
  blockOwnerDeletion: boolean;
  controller: boolean;
}

interface CacheEntry {
  ref: K8sOwnerReference;
  cachedAt: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/**
 * Resolve the Tenant's ownerRef by name. Result is cached per-process for
 * 60s to avoid GET'ing the Tenant CR on every child-creating action call.
 *
 * Returns null on any k8s error — caller falls through to create the child
 * WITHOUT an ownerRef. The operator's reconciler backfill will attach it
 * on next reconcile, so this path is safe (no data loss, just a short
 * window where the child has no ownerRef).
 */
export async function getTenantOwnerRef(
  name: string,
): Promise<K8sOwnerReference | null> {
  const now = Date.now();
  const hit = cache.get(name);
  if (hit && now - hit.cachedAt < TTL_MS) {
    return hit.ref;
  }

  try {
    const t = await k8s().get<Tenant>('Tenant', name);
    const uid = t.metadata.uid;
    if (!uid) return null;
    const ref: K8sOwnerReference = {
      apiVersion: 'gibson.zeroroot.ai/v1alpha1',
      kind: 'Tenant',
      name: t.metadata.name,
      uid,
      blockOwnerDeletion: false,
      controller: false,
    };
    cache.set(name, { ref, cachedAt: now });
    return ref;
  } catch (err) {
    console.warn(`[k8s.owner-ref] tenant lookup failed name=${name}:`, err);
    return null;
  }
}
