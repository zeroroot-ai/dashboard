import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { safeErrorResponse } from '@/src/lib/api-errors';
import { TIER_CONFIGS, type TierLevel } from '@/src/lib/tier-checker';
import { planIDs } from '@/src/generated/plans';

/**
 * GET /api/settings/tier
 *
 * Returns the current tenant's tier configuration and usage statistics.
 * Reads tier from GIBSON_TIER env var (default: solo) until the daemon
 * exposes a billing RPC. Values are derived from the canonical plan
 * registry via @/src/lib/tier-checker.
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

    const envTier = (process.env.GIBSON_TIER ?? 'solo').toLowerCase();
    const tier: TierLevel =
      (planIDs as readonly string[]).includes(envTier)
        ? (envTier as TierLevel)
        : 'solo';
    const config = TIER_CONFIGS[tier];

    // Usage not tracked server-side yet; return zeroed counters until the
    // daemon's GetTenantQuota RPC (see spec task 19) is wired in.
    const usage = {
      teamMemberCount: 0,
      apiKeyCount: 0,
      customRoleCount: 0,
      pendingInvitationCount: 0,
    };

    return NextResponse.json({ config, usage });
  } catch (error) {
    return safeErrorResponse(error, 'Failed to fetch tier', 500);
  }
}
