import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';

/**
 * Tier configurations keyed by tier level.
 * These mirror the client-side TIER_CONFIGS in useTierLimits.ts.
 */
const TIER_CONFIGS = {
  indie: {
    tier: 'indie',
    displayName: 'Indie',
    maxTeamMembers: 1,
    maxAPIKeys: Infinity,
    customRolesEnabled: false,
    auditLogRetentionDays: 30,
    ssoEnabled: false,
    prioritySupport: false,
  },
  team: {
    tier: 'team',
    displayName: 'Team',
    maxTeamMembers: 5,
    maxAPIKeys: Infinity,
    customRolesEnabled: false,
    auditLogRetentionDays: 30,
    ssoEnabled: false,
    prioritySupport: false,
  },
  business: {
    tier: 'business',
    displayName: 'Business',
    maxTeamMembers: 20,
    maxAPIKeys: Infinity,
    customRolesEnabled: true,
    auditLogRetentionDays: 90,
    ssoEnabled: true,
    prioritySupport: true,
  },
  enterprise: {
    tier: 'enterprise',
    displayName: 'Enterprise',
    maxTeamMembers: Infinity,
    maxAPIKeys: Infinity,
    customRolesEnabled: true,
    auditLogRetentionDays: 365,
    ssoEnabled: true,
    prioritySupport: true,
  },
} as const;

type TierLevel = keyof typeof TIER_CONFIGS;

/**
 * GET /api/settings/tier
 *
 * Returns the current tenant's tier configuration and usage statistics.
 * Reads tier from GIBSON_TIER env var (default: team) until daemon billing
 * RPC is available.
 *
 * Requires authentication.
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

    // Resolve tier from environment variable — allows ops to override per-deployment
    // without requiring a billing RPC. Falls back to 'team' when unset.
    const envTier = (process.env.GIBSON_TIER ?? 'team').toLowerCase() as TierLevel;
    const tier: TierLevel = Object.keys(TIER_CONFIGS).includes(envTier) ? envTier : 'team';
    const config = TIER_CONFIGS[tier];

    // Usage is not tracked server-side yet; return zeroed counters as defaults.
    // Replace with daemon RPC calls (ListTeamMembers, ListAPIKeys) when available.
    const usage = {
      teamMemberCount: 0,
      apiKeyCount: 0,
      customRoleCount: 0,
      pendingInvitationCount: 0,
    };

    return NextResponse.json({ config, usage });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to update settings', 500);
  }
}
