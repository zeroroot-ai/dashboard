/**
 * Per-tenant LLM provider configuration storage.
 *
 * Before the CRD migration, provider configs were stored as a JSON string
 * in the Tenant record's `config.providers` field — written via the now
 * deleted UpdateTenant daemon RPC. This module replaces that storage with
 * a Kubernetes Secret in the tenant namespace, which is the correct home
 * for credential material anyway.
 *
 * Secret shape:
 *
 *   Name:      llm-providers
 *   Namespace: tenant-{name}
 *   Data:
 *     providers:   JSON-encoded ProviderConfig[]
 */

import 'server-only';

import {
  CoreV1Api,
  KubeConfig,
  V1Secret,
} from '@kubernetes/client-node';

import { mapK8sError, K8sNotFoundError } from './errors';
import { tenantNamespace } from './tenants';

const SECRET_NAME = 'llm-providers';
const DATA_KEY = 'providers';

export interface ProviderConfig {
  name: string;
  type: 'anthropic' | 'openai' | 'google' | 'ollama';
  apiKey: string;
  model: string;
  baseUrl?: string;
  isDefault?: boolean;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

let _core: CoreV1Api | null = null;

function coreApi(): CoreV1Api {
  if (!_core) {
    const kc = new KubeConfig();
    if (process.env.NODE_ENV === 'production' || process.env.KUBERNETES_SERVICE_HOST) {
      kc.loadFromCluster();
    } else {
      kc.loadFromDefault();
    }
    _core = kc.makeApiClient(CoreV1Api);
  }
  return _core;
}

/**
 * Read the provider list for a tenant. Returns an empty array if the
 * Secret does not exist yet.
 */
export async function readProviders(tenantId: string): Promise<ProviderConfig[]> {
  const ns = tenantNamespace(tenantId);
  try {
    const secret = (await coreApi().readNamespacedSecret({
      namespace: ns,
      name: SECRET_NAME,
    })) as unknown as V1Secret;
    const data = secret.data ?? {};
    const encoded = data[DATA_KEY];
    if (!encoded) return [];
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded) as ProviderConfig[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    const mapped = mapK8sError(err);
    if (mapped instanceof K8sNotFoundError) return [];
    throw mapped;
  }
}

/**
 * Persist the provider list for a tenant. Creates the Secret on first
 * write, updates in place otherwise.
 */
export async function writeProviders(
  tenantId: string,
  providers: ProviderConfig[],
): Promise<void> {
  const ns = tenantNamespace(tenantId);
  const payload = Buffer.from(JSON.stringify(providers), 'utf-8').toString('base64');
  const body: V1Secret = {
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: {
      name: SECRET_NAME,
      namespace: ns,
      labels: {
        'gibson.io/managed-by': 'dashboard',
        'gibson.io/tenant': tenantId,
        'gibson.io/kind': 'llm-providers',
      },
    },
    type: 'Opaque',
    data: {
      [DATA_KEY]: payload,
    },
  };

  try {
    await coreApi().readNamespacedSecret({ namespace: ns, name: SECRET_NAME });
    // Exists — patch.
    await coreApi().replaceNamespacedSecret({
      namespace: ns,
      name: SECRET_NAME,
      body,
    });
  } catch (err) {
    const mapped = mapK8sError(err);
    if (!(mapped instanceof K8sNotFoundError)) throw mapped;
    // Create.
    try {
      await coreApi().createNamespacedSecret({ namespace: ns, body });
    } catch (createErr) {
      throw mapK8sError(createErr);
    }
  }
}
