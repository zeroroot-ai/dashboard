/**
 * Chat Agents API Route
 *
 * GET /api/chat/agents - List available chat agents
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { listAgents } from '@/src/lib/gibson-client';

// ============================================================================
// Types
// ============================================================================

export interface ChatAgent {
  id: string;
  name: string;
  description: string;
  status: 'online' | 'busy' | 'offline';
  capabilities: string[];
  icon?: string;
}

// ============================================================================
// Agent definitions
// ============================================================================

const AGENTS: ChatAgent[] = [
  {
    id: 'general',
    name: 'General Assistant',
    description: 'General purpose assistant for questions and guidance about the platform',
    status: 'online',
    capabilities: ['general', 'help', 'documentation', 'navigation'],
    icon: 'bot',
  },
  {
    id: 'recon',
    name: 'Reconnaissance Agent',
    description: 'Specializes in target enumeration, OSINT, and attack surface discovery',
    status: 'online',
    capabilities: ['recon', 'enumeration', 'osint', 'subdomain', 'port-scan'],
    icon: 'search',
  },
  {
    id: 'exploit',
    name: 'Exploit Agent',
    description: 'Vulnerability exploitation, payload generation, and proof-of-concept development',
    status: 'online',
    capabilities: ['exploit', 'payloads', 'vulnerabilities', 'cve', 'poc'],
    icon: 'zap',
  },
  {
    id: 'analysis',
    name: 'Analysis Agent',
    description: 'Deep analysis of findings, attack path mapping, and risk correlation',
    status: 'online',
    capabilities: ['analysis', 'reporting', 'correlation', 'risk', 'attack-path'],
    icon: 'activity',
  },
  {
    id: 'remediation',
    name: 'Remediation Advisor',
    description: 'Provides remediation guidance, fix recommendations, and security hardening advice',
    status: 'online',
    capabilities: ['remediation', 'fixes', 'hardening', 'compliance', 'best-practices'],
    icon: 'shield',
  },
];

// ============================================================================
// GET Handler
// ============================================================================

export async function GET(request: NextRequest): Promise<Response> {
  try {
    // Check authentication
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Attempt to fetch real-time agent health from the daemon and overlay status
    // onto the static agent definitions. Falls back to the static list on failure.
    let agents = AGENTS;
    try {
      const daemonResponse = await listAgents(undefined, session?.user?.id);
      if (daemonResponse.agents.length > 0) {
        const healthByKind = new Map(
          daemonResponse.agents.map((a) => [a.kind, a.health])
        );
        agents = AGENTS.map((agent) => {
          const health = healthByKind.get(agent.id);
          if (health === undefined) return agent;
          const status: ChatAgent['status'] =
            health === 'healthy' ? 'online' : health === 'busy' ? 'busy' : 'offline';
          return { ...agent, status };
        });
      }
    } catch {
      // Daemon unavailable — serve static agent list with default statuses.
    }

    return NextResponse.json({
      agents,
      defaultAgentId: 'general',
    });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to process chat request', 500);
  }
}
