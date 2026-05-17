import { NextRequest, NextResponse } from 'next/server';

import { getServerSession } from '@/src/lib/auth';
import { daemonErrorResponse } from '@/src/lib/api-errors';
import { TIER_CONFIGS, type TierLevel } from '@/src/lib/tier-checker';
import { planIDs } from '@/src/generated/plans';

/**
 * GET /api/settings/tier
 *
 * Returns the current tenant's tier configuration + usage. Spec
 * plans-and-quotas-simplification reduces this to two enforced quotas;
 * legacy fields (teamMemberCount / apiKeyCount / customRoleCount /
 * pendingInvitationCount) are removed from the response shape.
 *
 * Requires authentication.
 */
export async function GET(_request: NextRequest) {
  try {
    const session = await getServerSession();
    if (!session) {
      return NextResponse.json(
        { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
        { status: 401 },
      );
    }

    const envTier = (process.env.GIBSON_TIER ?? 'team').toLowerCase();
    const tier: TierLevel = (planIDs as readonly string[]).includes(envTier)
      ? (envTier as TierLevel)
      : 'team';
    const config = TIER_CONFIGS[tier];

    // Usage not tracked here yet; the daemon's GetTenantQuotaUsage RPC
    // is the live source. /api/settings/tier returns zeros until a
    // dedicated wiring lands; the in-app QuotaWidget reads
    // GetTenantQuotaUsage directly via a Server Action.
    const usage = {
      concurrentMissions: 0,
      concurrentAgents: 0,
    };

    return NextResponse.json({ config, usage });
  } catch (error) {
    return daemonErrorResponse(error);
  }
}
