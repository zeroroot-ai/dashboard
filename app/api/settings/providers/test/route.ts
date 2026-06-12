/**
 * POST /api/settings/providers/test, test a proposed provider config
 *
 * Accepts a DaemonProviderConfigInput, invokes the daemon TestProvider RPC,
 * and returns the structured test result. The config is NEVER persisted -
 * it transits daemon process memory for one request only.
 *
 * IMPORTANT: Credentials in the request body are NEVER logged, even on error.
 * Only error metadata (code, message) is logged.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import {
  daemonTestProvider,
  type DaemonProviderConfigInput,
} from '@/src/lib/gibson-client';
import { translateError } from '@/src/lib/providers-route-error';

// ---------------------------------------------------------------------------
// POST /api/settings/providers/test
// ---------------------------------------------------------------------------

/**
 * Test connectivity to an LLM provider with the given config.
 *
 * Request body shape matches DaemonProviderConfigInput (type + name + credentials).
 * The config is validated and probed by the daemon without being stored.
 *
 * Returns a DaemonProviderTestResult:
 *   ok         boolean , true when the upstream returned a successful response
 *   latencyMs  number  , round-trip time in milliseconds (always present)
 *   model      string  , model used for the test (when ok is true)
 *   error      string? , cleaned upstream error message (when ok is false)
 *
 * Rate-limited server-side by the daemon (ResourceExhausted → 429).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  const userId = session.user.id;
  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  let body: DaemonProviderConfigInput;
  try {
    body = await req.json() as DaemonProviderConfigInput;
  } catch {
    return Response.json(
      { error: { code: 'invalid_argument', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  try {
    const result = await daemonTestProvider(body, userId, tenantId);
    return Response.json({ result });
  } catch (err) {
    return translateError(err);
  }
}
