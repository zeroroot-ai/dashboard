import 'server-only';

import { serverConfig } from '@/src/lib/config';
import {
  getTenantLangfuseCredentials,
  ConnectError,
  Code,
} from '@/src/lib/gibson-client';
import {
  LangfuseClient,
  type LangfuseTracePage,
} from '@/src/lib/langfuse-client';

/**
 * Gibson Traces credential resolution + project-wide trace listing.
 *
 * This module is the SINGLE source of Langfuse credential resolution in the
 * dashboard. Every route that needs a tenant-scoped Langfuse client resolves
 * it through {@link resolveLangfuseClient} — there is no inline fallback logic
 * anywhere else (one-codepath discipline, ADR-0027).
 *
 * Resolution order:
 *   1. Per-tenant credentials from the Gibson daemon (preferred).
 *   2. When the daemon reports the tenant is not yet provisioned
 *      (gRPC NOT_FOUND), fall back to the platform-level credentials.
 *   3. When no tenant id is supplied, use the platform-level credentials.
 *
 * Returns `null` when no usable credentials exist (host / public key / secret
 * key missing). Callers map `null` to a NOT_CONFIGURED response.
 *
 * Server-only: never importable from browser code.
 */

interface ResolvedCredentials {
  host: string | null;
  publicKey: string | undefined;
  secretKey: string | undefined;
}

function platformCredentials(): ResolvedCredentials {
  return {
    host: serverConfig.langfuseHost,
    publicKey: serverConfig.langfuseAdminPublicKey,
    secretKey: serverConfig.langfuseAdminSecretKey,
  };
}

/**
 * Resolve a Langfuse client scoped to the given tenant, or `null` when no
 * usable credentials are configured.
 */
export async function resolveLangfuseClient(
  tenantId: string | null | undefined,
  userId?: string,
): Promise<LangfuseClient | null> {
  let creds: ResolvedCredentials;

  if (tenantId) {
    try {
      const tenantCreds = await getTenantLangfuseCredentials(tenantId, userId);
      creds = {
        // A per-tenant host may be blank; fall back to the platform host.
        host: tenantCreds.host || serverConfig.langfuseHost,
        publicKey: tenantCreds.publicKey,
        secretKey: tenantCreds.secretKey,
      };
    } catch (err) {
      if (err instanceof ConnectError && err.code === Code.NotFound) {
        // Tenant not provisioned yet — fall back to platform credentials.
        creds = platformCredentials();
      } else {
        throw err;
      }
    }
  } else {
    creds = platformCredentials();
  }

  if (!creds.host || !creds.publicKey || !creds.secretKey) {
    return null;
  }

  return new LangfuseClient({
    host: creds.host,
    publicKey: creds.publicKey,
    secretKey: creds.secretKey,
  });
}

export interface ListTenantTracesOpts {
  page?: number;
  limit?: number;
  /** ISO-8601 lower bound (inclusive) on trace timestamp. */
  fromTimestamp?: string;
  /** ISO-8601 upper bound on trace timestamp. */
  toTimestamp?: string;
  /** Substring filter on trace name. */
  name?: string;
}

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 25;

/**
 * List every trace in the tenant's project (no userId filter), applying
 * pagination + optional date / name filters. Project scoping comes from the
 * client's credentials.
 */
export async function listTenantTraces(
  client: LangfuseClient,
  opts: ListTenantTracesOpts = {},
): Promise<LangfuseTracePage> {
  return client.listTracesPaged({
    page: opts.page ?? DEFAULT_PAGE,
    limit: opts.limit ?? DEFAULT_LIMIT,
    fromTimestamp: opts.fromTimestamp,
    toTimestamp: opts.toTimestamp,
    name: opts.name,
  });
}
