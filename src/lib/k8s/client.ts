/**
 * Server-side Kubernetes client singleton. Reads in-cluster credentials in
 * production (ServiceAccount + CA) and falls back to ~/.kube/config in dev.
 *
 * This module is Node.js runtime only, never import from Client Components.
 */

import 'server-only';

import {
  KubeConfig,
  CustomObjectsApi,
  CoreV1Api,
  Watch,
  setHeaderOptions,
} from '@kubernetes/client-node';

import {
  CRDKind,
  CRDPlurals,
  GibsonCRD,
  WatchEvent,
} from './types';
import { mapK8sError } from './errors';

const GIBSON_GROUP = 'gibson.zeroroot.ai';
const GIBSON_VERSION = 'v1alpha1';

type AbortLike = { abort: () => void };

class K8sClient {
  private kc: KubeConfig;
  private customApi: CustomObjectsApi;
  private coreApi: CoreV1Api;
  private watcher: Watch;

  constructor() {
    this.kc = new KubeConfig();
    if (process.env.NODE_ENV === 'production' || process.env.KUBERNETES_SERVICE_HOST) {
      this.kc.loadFromCluster();
    } else {
      this.kc.loadFromDefault();
    }
    this.customApi = this.kc.makeApiClient(CustomObjectsApi);
    this.coreApi = this.kc.makeApiClient(CoreV1Api);
    this.watcher = new Watch(this.kc);
  }

  // ---- generic CRUD ----

  async apply<T extends GibsonCRD>(resource: T, clusterScoped: boolean): Promise<T> {
    const plural = CRDPlurals[resource.kind as CRDKind];
    try {
      if (clusterScoped) {
        const res = await this.customApi.createClusterCustomObject({
          group: GIBSON_GROUP,
          version: GIBSON_VERSION,
          plural,
          body: resource,
        });
        return res as unknown as T;
      } else {
        const res = await this.customApi.createNamespacedCustomObject({
          group: GIBSON_GROUP,
          version: GIBSON_VERSION,
          namespace: resource.metadata.namespace!,
          plural,
          body: resource,
        });
        return res as unknown as T;
      }
    } catch (err) {
      throw mapK8sError(err);
    }
  }

  async get<T extends GibsonCRD>(kind: CRDKind, name: string, namespace?: string): Promise<T> {
    const plural = CRDPlurals[kind];
    try {
      if (namespace) {
        const res = await this.customApi.getNamespacedCustomObject({
          group: GIBSON_GROUP,
          version: GIBSON_VERSION,
          namespace,
          plural,
          name,
        });
        return res as unknown as T;
      }
      const res = await this.customApi.getClusterCustomObject({
        group: GIBSON_GROUP,
        version: GIBSON_VERSION,
        plural,
        name,
      });
      return res as unknown as T;
    } catch (err) {
      throw mapK8sError(err);
    }
  }

  async list<T extends GibsonCRD>(kind: CRDKind, namespace?: string): Promise<T[]> {
    const plural = CRDPlurals[kind];
    try {
      const res = namespace
        ? await this.customApi.listNamespacedCustomObject({
            group: GIBSON_GROUP,
            version: GIBSON_VERSION,
            namespace,
            plural,
          })
        : await this.customApi.listClusterCustomObject({
            group: GIBSON_GROUP,
            version: GIBSON_VERSION,
            plural,
          });
      return ((res as { items?: T[] }).items ?? []) as T[];
    } catch (err) {
      throw mapK8sError(err);
    }
  }

  async delete(kind: CRDKind, name: string, namespace?: string): Promise<void> {
    const plural = CRDPlurals[kind];
    try {
      if (namespace) {
        await this.customApi.deleteNamespacedCustomObject({
          group: GIBSON_GROUP,
          version: GIBSON_VERSION,
          namespace,
          plural,
          name,
        });
      } else {
        await this.customApi.deleteClusterCustomObject({
          group: GIBSON_GROUP,
          version: GIBSON_VERSION,
          plural,
          name,
        });
      }
    } catch (err) {
      throw mapK8sError(err);
    }
  }

  async patch<T extends GibsonCRD>(
    kind: CRDKind,
    name: string,
    patch: object,
    namespace?: string,
  ): Promise<T> {
    const plural = CRDPlurals[kind];
    try {
      const body = patch as object;
      // The patch body is a merge object ({ metadata: {...}, status: {...} }),
      // not an RFC6902 op array. client-node defaults the patch Content-Type to
      // application/json-patch+json, which makes the API try to decode our
      // object as []jsonPatchOp ("cannot unmarshal object into Go value of type
      // []handlers.jsonPatchOp"). Force application/merge-patch+json so the
      // object is applied as a strategic/merge patch (e.g. the Stripe webhook
      // stamping the billing-active annotation, dashboard#780/#785).
      const mergeOpts = setHeaderOptions(
        'Content-Type',
        'application/merge-patch+json',
      );
      const res = namespace
        ? await this.customApi.patchNamespacedCustomObject(
            {
              group: GIBSON_GROUP,
              version: GIBSON_VERSION,
              namespace,
              plural,
              name,
              body,
            },
            mergeOpts,
          )
        : await this.customApi.patchClusterCustomObject(
            {
              group: GIBSON_GROUP,
              version: GIBSON_VERSION,
              plural,
              name,
              body,
            },
            mergeOpts,
          );
      return res as unknown as T;
    } catch (err) {
      throw mapK8sError(err);
    }
  }

  // ---- watch (for SSE proxy) ----

  async watch<T extends GibsonCRD>(
    kind: CRDKind,
    namespace: string | undefined,
    onEvent: (evt: WatchEvent<T>) => void,
    onError: (err: Error) => void,
  ): Promise<AbortLike> {
    const plural = CRDPlurals[kind];
    const path = namespace
      ? `/apis/${GIBSON_GROUP}/${GIBSON_VERSION}/namespaces/${namespace}/${plural}`
      : `/apis/${GIBSON_GROUP}/${GIBSON_VERSION}/${plural}`;
    const req = await this.watcher.watch(
      path,
      {},
      (type: string, obj: unknown) => {
        onEvent({ type: type as WatchEvent<T>['type'], object: obj as T });
      },
      (err: unknown) => {
        if (err) onError(err as Error);
      },
    );
    return req as AbortLike;
  }

  // ---- secrets (for bootstrap token display) ----

  async getSecret(namespace: string, name: string): Promise<{ data?: Record<string, string> }> {
    try {
      const res = await this.coreApi.readNamespacedSecret({ namespace, name });
      return res as unknown as { data?: Record<string, string> };
    } catch (err) {
      throw mapK8sError(err);
    }
  }
}

// Singleton. Lazy-init.
let _client: K8sClient | null = null;

export function k8s(): K8sClient {
  if (!_client) {
    _client = new K8sClient();
  }
  return _client;
}
