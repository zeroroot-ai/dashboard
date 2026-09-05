import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { listTools, serializeTool } from '@/src/lib/gibson-client';
import type { ComponentHealth } from '@/src/types';

/**
 * GET /api/components/tools
 *
 * List all registered tools from Gibson daemon.
 */
export async function GET() {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 }
      );
    }

    // Fail closed: require an active tenant before listing components.
    // The daemon resolves tenant context from SPIFFE mTLS; tenantId is
    // not passed to the RPC but guards against unauthenticated listing.
    try {
      await requireActiveTenant();
    } catch (err) {
      return activeTenantApiResponse(err);
    }

    // Query tools, SPIFFE mTLS transport resolves both _system and tenant components.
    const [systemResponse, tenantResponse] = await Promise.all([
      listTools(session?.user?.id),
      Promise.resolve({ tools: [] }),
    ]);

    const seen = new Set<string>();
    const allTools = [...systemResponse.tools, ...(tenantResponse.tools || [])].filter((t) => {
      const id = t.id || t.name;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const tools: ComponentHealth[] = allTools.map((t) => {
      const serialized = serializeTool(t);
      return {
        id: serialized.id,
        name: serialized.name,
        type: 'tool' as const,
        status: mapHealthToStatus(serialized.health),
        lastActivity: serialized.lastSeen ? new Date(serialized.lastSeen) : undefined,
        replicas: 1,
        resourceUtilization: undefined,
        errorRate: undefined,
        metadata: {
          version: serialized.version,
          endpoint: serialized.endpoint,
          description: serialized.description,
          hasRoot: (serialized as unknown as { capabilities?: { hasRoot?: boolean } }).capabilities?.hasRoot ? 'Yes' : 'No',
          hasSudo: (serialized as unknown as { capabilities?: { hasSudo?: boolean } }).capabilities?.hasSudo ? 'Yes' : 'No',
          canRawSocket: (serialized as unknown as { capabilities?: { canRawSocket?: boolean } }).capabilities?.canRawSocket ? 'Yes' : 'No',
        },
      };
    });

    return NextResponse.json({ tools, total: tools.length });
  } catch (error) {
    console.error('Failed to fetch tools:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch tools' } },
      { status: 500 }
    );
  }
}

function mapHealthToStatus(health: string): 'healthy' | 'degraded' | 'unhealthy' | 'unknown' {
  // Normalize health string (case-insensitive, with or without prefix)
  const normalized = health?.toLowerCase().replace('health_', '') || '';

  switch (normalized) {
    case 'healthy':
    case '1': // protobuf enum value
      return 'healthy';
    case 'degraded':
    case '2':
      return 'degraded';
    case 'unhealthy':
    case '3':
      return 'unhealthy';
    case 'unknown':
    case '0':
    case '':
      return 'unknown';
    default:
      return 'unknown';
  }
}
