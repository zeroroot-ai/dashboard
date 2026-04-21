/**
 * GET /api/settings/providers/supported — descriptor list for the daemon's
 * supported LLM provider types (credential schema + default model catalogue).
 *
 * Client-side hook `useSupportedProviders()` calls this instead of importing
 * `gibson-client.ts` directly so the SPIFFE/gRPC transport stays server-only.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { getSupportedProviders } from '@/src/lib/gibson-client';
import { translateError } from '@/src/lib/providers-route-error';

export async function GET(_req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  const userId = session.user.id;
  const tenantId = session.user.tenantId ?? undefined;

  try {
    const providers = await getSupportedProviders(userId, tenantId);
    return Response.json({ providers });
  } catch (err) {
    return translateError(err);
  }
}
