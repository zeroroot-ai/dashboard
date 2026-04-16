import { NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { listAgents, serializeAgent } from '@/src/lib/gibson-client';
import type { ComponentHealth } from '@/src/types';

/**
 * GET /api/components/agents
 *
 * List all registered agents from Gibson daemon.
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

    const tenantId = session.user.tenantId;

    // Query agents — SPIFFE mTLS transport resolves both _system and tenant components.
    const [systemResponse, tenantResponse] = await Promise.all([
      listAgents(undefined, session?.user?.id),
      Promise.resolve({ agents: [] }),
    ]);

    const seen = new Set<string>();
    const allAgents = [...systemResponse.agents, ...(tenantResponse.agents || [])].filter((a) => {
      const id = a.id || a.name;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    const agents: ComponentHealth[] = allAgents.map((a) => {
      const serialized = serializeAgent(a);
      return {
        id: serialized.id,
        name: serialized.name,
        type: 'agent' as const,
        status: mapHealthToStatus(serialized.health),
        lastActivity: serialized.lastSeen ? new Date(serialized.lastSeen) : undefined,
        replicas: 1,
        resourceUtilization: undefined,
        errorRate: undefined,
        metadata: {
          kind: serialized.kind,
          version: serialized.version,
          endpoint: serialized.endpoint,
          capabilities: serialized.capabilities?.join(', ') || '',
        },
      };
    });

    return NextResponse.json({ agents, total: agents.length });
  } catch (error) {
    console.error('Failed to fetch agents:', error);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch agents' } },
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
