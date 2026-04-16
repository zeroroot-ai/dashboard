/**
 * Dashboard-side authorization schema cache.
 *
 * The daemon's declarative-rbac-framework loads permissions.yaml at startup
 * and serves the live schema via the GetAuthSchema RPC. This module:
 *
 *   1. Fetches the schema at first use (or after TTL expiry).
 *   2. Caches it at module scope so every server-side route handler
 *      that imports from here shares one in-process copy.
 *   3. Exposes hasPermission(session, "tenants:provision") and
 *      canCallRpc(session, "/gibson.daemon.admin.v1.DaemonAdminService/ProvisionTenant")
 *      helpers that every route handler uses instead of hardcoded role
 *      names.
 *
 * Added by the declarative-rbac-framework spec. Replaces the deleted
 * src/lib/auth/rbac.ts module and the role-check helpers in
 * src/lib/auth.ts.
 */

// GetAuthSchema RPC was removed from the daemon proto. Authorization
// decisions are now FGA-backed via DaemonService.GetMyPermissions, and the
// dashboard does not consume a declarative schema. We retain the
// loadSchema() entry point as a no-op that returns an empty schema so the
// JWT callback continues to function (default-deny on permission lookups).
async function fetchSchemaRPC(): Promise<GetAuthSchemaResponse> {
  return { schemaVersion: '', roles: [], permissions: [], rpcRequirements: {} };
}

// ---------------------------------------------------------------------------
// Minimal session interface used by schema helpers.
// Matches the GibsonSession shape from src/lib/auth without importing it
// (avoiding a circular dependency: auth.ts -> schema.ts -> auth.ts).
// ---------------------------------------------------------------------------

interface SessionWithPermissions {
  user?: {
    permissions?: string[];
    crossTenant?: boolean;
  } | null;
}

// ---------------------------------------------------------------------------
// Local proto-compatible types (GetAuthSchema RPC removed in authz-04;
// these mirror the old wire shape for backward compat with normalizeResponse)
// ---------------------------------------------------------------------------

interface ProtoAuthRole {
  name: string;
  description: string;
  inherits: string[];
  permissions: string[];
  effectivePermissions: string[];
  crossTenant: boolean;
}

interface ProtoAuthPermission {
  name: string;
  resource: string;
  action: string;
  description: string;
}

interface ProtoAuthRpcRequirement {
  method: string;
  requiredPermissions: string[];
  tenantScoped: boolean;
  unauthenticated: boolean;
}

interface GetAuthSchemaResponse {
  schemaVersion: string;
  roles: ProtoAuthRole[];
  permissions: ProtoAuthPermission[];
  rpcRequirements: Record<string, ProtoAuthRpcRequirement>;
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AuthSchema = {
  schemaVersion: string;
  roles: Map<string, AuthRole>;
  permissions: Map<string, AuthPermission>;
  rpcRequirements: Map<string, AuthRpcRequirement>;
  // Precomputed union of every role's effective_permissions, used for
  // O(1) hasPermission resolution across multiple roles.
  effectivePermissionsByRole: Map<string, Set<string>>;
};

export type AuthRole = {
  name: string;
  description: string;
  inherits: string[];
  permissions: string[];
  effectivePermissions: string[];
  crossTenant: boolean;
};

export type AuthPermission = {
  name: string;
  resource: string;
  action: string;
  description: string;
};

export type AuthRpcRequirement = {
  method: string;
  requiredPermissions: string[];
  tenantScoped: boolean;
  unauthenticated: boolean;
};

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------

const SCHEMA_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RETRY_DELAYS_MS = [200, 400, 800]; // exponential backoff, 3 attempts

let cachedSchema: AuthSchema | null = null;
let cachedAt = 0;
let inflight: Promise<AuthSchema> | null = null;

/**
 * Force-invalidate the cache. Used by tests and by any future
 * /api/admin/refresh-auth-schema route that wants to pick up a freshly
 * rolled-out daemon without waiting for TTL.
 */
export function invalidateSchema(): void {
  cachedSchema = null;
  cachedAt = 0;
  inflight = null;
}

/**
 * Load the daemon's authorization schema, using the cached copy when fresh.
 *
 * Retries the RPC with exponential backoff (3 attempts at 200/400/800ms)
 * on transient failures. On final failure, throws — route handlers that
 * call this should catch and return HTTP 503 "service initializing" so
 * the user sees a clear message rather than a stack trace.
 *
 * Concurrent callers share a single in-flight fetch (request coalescing)
 * to avoid N parallel RPCs on dashboard startup.
 */
export async function loadSchema(): Promise<AuthSchema> {
  const now = Date.now();
  if (cachedSchema && now - cachedAt < SCHEMA_TTL_MS) {
    return cachedSchema;
  }
  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
      try {
        const resp = await fetchSchemaRPC();
        const schema = normalizeResponse(resp);
        cachedSchema = schema;
        cachedAt = Date.now();
        return schema;
      } catch (err) {
        lastErr = err;
        if (attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        }
      }
    }
    throw new Error(
      `loadSchema: failed after ${RETRY_DELAYS_MS.length + 1} attempts: ${
        lastErr instanceof Error ? lastErr.message : String(lastErr)
      }`,
    );
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/**
 * Convert the raw Connect-ES proto response into our public AuthSchema
 * shape. The proto wire format uses repeated fields + a map; we normalize
 * to Maps + pre-computed role→effective-permission sets for O(1) lookup.
 */
function normalizeResponse(resp: GetAuthSchemaResponse): AuthSchema {
  const roles = new Map<string, AuthRole>();
  const effectivePermissionsByRole = new Map<string, Set<string>>();
  for (const r of resp.roles as ProtoAuthRole[]) {
    const role: AuthRole = {
      name: r.name,
      description: r.description,
      inherits: [...r.inherits],
      permissions: [...r.permissions],
      effectivePermissions: [...r.effectivePermissions],
      crossTenant: r.crossTenant,
    };
    roles.set(r.name, role);
    effectivePermissionsByRole.set(r.name, new Set(r.effectivePermissions));
  }

  const permissions = new Map<string, AuthPermission>();
  for (const p of resp.permissions as ProtoAuthPermission[]) {
    permissions.set(p.name, {
      name: p.name,
      resource: p.resource,
      action: p.action,
      description: p.description,
    });
  }

  const rpcRequirements = new Map<string, AuthRpcRequirement>();
  for (const [method, req] of Object.entries(resp.rpcRequirements) as Array<
    [string, ProtoAuthRpcRequirement]
  >) {
    rpcRequirements.set(method, {
      method: req.method || method,
      requiredPermissions: [...req.requiredPermissions],
      tenantScoped: req.tenantScoped,
      unauthenticated: req.unauthenticated,
    });
  }

  return {
    schemaVersion: resp.schemaVersion,
    roles,
    permissions,
    rpcRequirements,
    effectivePermissionsByRole,
  };
}

// ---------------------------------------------------------------------------
// JWT-callback helpers — called from auth.ts during sign-in / token refresh
// to resolve a user's roles into their effective permission closure plus a
// crossTenant flag, both of which are then stored on the session so all
// downstream permission checks are SYNC.
//
// The schema is fetched once per token via loadSchema() (which is cached
// in-process with a 5min TTL), so the cost of resolution is paid once per
// sign-in / refresh, not per request.
// ---------------------------------------------------------------------------

/**
 * Resolve the union of effective permissions granted by the supplied roles
 * against the live daemon schema. Used by the auth.ts JWT callback.
 *
 * Returns an empty array if the schema fetch fails — the route handlers
 * will then fail every permission check, which is the correct default-deny
 * behavior. Errors are logged but never thrown so a transient daemon
 * outage doesn't break the sign-in flow entirely.
 */
export async function resolveEffectivePermissions(
  roles: string[],
): Promise<string[]> {
  if (!roles || roles.length === 0) {
    return [];
  }
  try {
    const schema = await loadSchema();
    const out = new Set<string>();
    for (const role of roles) {
      const closure = schema.effectivePermissionsByRole.get(role);
      if (!closure) {
        continue;
      }
      for (const p of closure) {
        out.add(p);
      }
    }
    return [...out].sort();
  } catch (err) {
    console.error('[schema] resolveEffectivePermissions failed:', err);
    return [];
  }
}

/**
 * Resolve whether any of the supplied roles is flagged cross_tenant=true
 * in the live daemon schema. Used by the auth.ts JWT callback.
 */
export async function resolveCrossTenant(roles: string[]): Promise<boolean> {
  if (!roles || roles.length === 0) {
    return false;
  }
  try {
    const schema = await loadSchema();
    for (const roleName of roles) {
      const role = schema.roles.get(roleName);
      if (role?.crossTenant) {
        return true;
      }
    }
  } catch (err) {
    console.error('[schema] resolveCrossTenant failed:', err);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Session helpers — every dashboard route handler and React component
// calls these. They are SYNC by design: all the work happens once in the
// JWT callback, then session.user.permissions / session.user.crossTenant
// are read directly here. No daemon round-trip per request.
// ---------------------------------------------------------------------------

/**
 * Check whether the session holds the given permission.
 *
 * Sync: reads session.user.permissions which the JWT callback populated
 * by calling resolveEffectivePermissions() against the daemon's schema.
 * Returns false for null sessions, missing permissions, or when the
 * effective set doesn't include it.
 *
 * Permission strings are the canonical "resource:action" form declared
 * in core/gibson/internal/auth/permissions.yaml — never role names.
 */
export function hasPermission(
  session: SessionWithPermissions | null,
  permission: string,
): boolean {
  return session?.user?.permissions?.includes(permission) ?? false;
}

/**
 * True when the session holds at least one role flagged cross_tenant=true
 * in the daemon schema (platform-operator, provisioner, *-executor).
 *
 * Sync: reads session.user.crossTenant which the JWT callback populated.
 * Use this for routes that allow operating on a tenant other than the
 * session's active tenant (e.g. cross-tenant component management).
 */
export function isCrossTenant(session: SessionWithPermissions | null): boolean {
  return session?.user?.crossTenant ?? false;
}

/**
 * Check whether the session can call the given fully-qualified gRPC
 * method (e.g. "/gibson.daemon.admin.v1.DaemonAdminService/ProvisionTenant").
 *
 * Default-deny: returns false for unmapped methods, mirroring the
 * daemon's RPCAuthzInterceptor behavior so the dashboard's UI gating
 * cannot leak false positives.
 *
 * Unauthenticated RPCs (e.g. AcceptInvitation) always return true.
 * RPCs with empty required_permissions (e.g. GetAuthSchema) return true
 * when the session is non-null.
 *
 * This is async because rpc → permission requirements live in the schema
 * cache, not on the session. Use it sparingly — most callers can use the
 * sync hasPermission() instead since it's the same effective check for
 * single-permission RPCs.
 */
export async function canCallRpc(
  session: SessionWithPermissions | null,
  method: string,
): Promise<boolean> {
  const schema = await loadSchema();
  const req = schema.rpcRequirements.get(method);
  if (!req) {
    return false; // default-deny
  }
  if (req.unauthenticated) {
    return true;
  }
  if (!session) {
    return false;
  }
  if (req.requiredPermissions.length === 0) {
    return true; // any authenticated caller
  }
  for (const perm of req.requiredPermissions) {
    if (!hasPermission(session, perm)) {
      return false;
    }
  }
  return true;
}
