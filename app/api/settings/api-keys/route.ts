import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { hasPermission } from '@/src/lib/auth/schema';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { listAPIKeys, createAPIKey, revokeAPIKey } from '@/src/lib/gibson-client';

const COMPONENT_CAPABILITIES: Record<string, string[]> = {
  tool: ['components:register', 'tools:execute', 'graphrag:write'],
  agent: [
    'components:register', 'agents:delegate', 'tools:execute', 'llm:complete',
    'memory:read', 'memory:write', 'graphrag:read', 'graphrag:write',
    'findings:write', 'missions:execute',
  ],
  plugin: ['components:register'],
};

// ---------------------------------------------------------------------------
// GET /api/settings/api-keys
// ---------------------------------------------------------------------------

/**
 * List all API keys for the current tenant.
 *
 * Requires admin role. Returns key metadata only — raw key values are never
 * returned from this endpoint.
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    if (!hasPermission(session, 'apikeys:manage')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Admin role required to manage API keys' } },
        { status: 403 }
      );
    }

    const tenantId = session.user.tenantId ?? 'default';
    const keys = await listAPIKeys(tenantId, session?.user?.id);

    return NextResponse.json({ keys });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update settings', 500);
  }
}

// ---------------------------------------------------------------------------
// POST /api/settings/api-keys
// ---------------------------------------------------------------------------

/**
 * Generate a new API key for the current tenant.
 *
 * Request body:
 *   name           string    (required for non-component keys) — human-readable label encoded into allowedNames
 *   capabilities   string[]  (required when componentType is absent, non-empty) — capability strings
 *                            (e.g. "missions:execute") passed as allowedKinds to the daemon
 *   allowedNames   string[]  (optional) — specific component names this key may access
 *   componentType  string    (optional) — when present and a valid component type ("tool", "agent", "plugin"),
 *                            capabilities are derived automatically from COMPONENT_CAPABILITIES and the
 *                            explicit capabilities field is ignored
 *   componentName  string    (optional) — paired with componentType; used to form the key name as
 *                            "<componentType>-<componentName>"
 *
 * Capabilities are stored in allowedKinds on the daemon side. The name label
 * is prepended to allowedNames as a "name:<value>" entry so it survives round-trips.
 *
 * Returns the raw key value ONCE. It cannot be retrieved again.
 *
 * Requires admin role.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    if (!hasPermission(session, 'apikeys:manage')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Admin role required to generate API keys' } },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      name,
      capabilities,
      allowedKinds,
      allowedNames,
      componentType,
      componentName,
    } = body as {
      name?: string;
      capabilities?: string[];
      allowedKinds?: Array<'agent' | 'tool' | 'plugin'>;
      allowedNames?: string[];
      componentType?: string;
      componentName?: string;
    };

    // When componentType is provided and recognized, derive capabilities and key
    // name from the component definition — the caller's explicit capabilities are ignored.
    const isComponentKey = typeof componentType === 'string' && componentType in COMPONENT_CAPABILITIES;

    const resolvedCapabilities: string[] = isComponentKey
      ? COMPONENT_CAPABILITIES[componentType as string]
      : (capabilities ?? allowedKinds ?? []);

    if (!Array.isArray(resolvedCapabilities) || resolvedCapabilities.length === 0) {
      return NextResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'capabilities must be a non-empty array',
          },
        },
        { status: 400 }
      );
    }

    // Derive the name label: component keys use "<type>-<name>", others use the
    // explicit name field. The label is encoded into allowedNames with a reserved
    // prefix so it survives the round-trip through the daemon.
    const nameLabel = isComponentKey
      ? `${componentType}-${componentName ?? ''}`.replace(/-$/, '')
      : name?.trim();

    const resolvedAllowedNames: string[] = [];
    if (nameLabel) {
      resolvedAllowedNames.push(`name:${nameLabel}`);
    }
    if (Array.isArray(allowedNames)) {
      resolvedAllowedNames.push(...allowedNames.filter((n) => !n.startsWith('name:')));
    }

    const tenantId = session.user.tenantId ?? 'default';
    const result = await createAPIKey(tenantId, resolvedCapabilities, resolvedAllowedNames, session?.user?.id);

    // Build a synthetic key metadata record for the response so the client
    // can optimistically update the list without a refetch.
    const keyMeta: Record<string, unknown> = {
      keyId: result.keyId,
      tenantId: result.tenantId,
      allowedKinds: resolvedCapabilities,
      allowedNames: resolvedAllowedNames,
      createdAt: new Date().toISOString(),
      lastUsedAt: '',
      status: 'active' as const,
    };

    // Include component fields in the response when this is a component-scoped key.
    if (isComponentKey) {
      keyMeta.componentType = componentType;
      if (componentName !== undefined) {
        keyMeta.componentName = componentName;
      }
    }

    // Return the raw key only on creation — it will not be retrievable again.
    return NextResponse.json(
      { key: keyMeta, rawKey: result.rawKey },
      { status: 201 }
    );
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update settings', 500);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/settings/api-keys
// ---------------------------------------------------------------------------

/**
 * Revoke an API key by keyId.
 *
 * Request body:
 *   keyId  string  (required)
 *
 * Requires admin role.
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    if (!hasPermission(session, 'apikeys:manage')) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Admin role required to revoke API keys' } },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { keyId } = body as { keyId: string };

    if (!keyId || typeof keyId !== 'string') {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'keyId is required' } },
        { status: 400 }
      );
    }

    const tenantId = session.user.tenantId ?? 'default';
    await revokeAPIKey(tenantId, keyId, session?.user?.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update settings', 500);
  }
}
