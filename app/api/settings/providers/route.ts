/**
 * GET  /api/settings/providers — list all configured providers (masked creds)
 * POST /api/settings/providers — create a new provider config
 *
 * Both handlers delegate to the daemon TenantAdminService RPCs via
 * the typed client functions from gibson-client.ts. No storage logic lives
 * here — this file is delegation-only.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import {
  daemonListProviders,
  daemonCreateProvider,
  type DaemonProviderConfigInput,
} from '@/src/lib/gibson-client';
import { translateError } from '@/src/lib/providers-route-error';
import { toProviderConfig } from '@/src/lib/providers-adapter';

// ---------------------------------------------------------------------------
// GET /api/settings/providers
// ---------------------------------------------------------------------------

/**
 * List all LLM provider configs for the current tenant.
 * Returns masked credential values only — plaintext is never returned.
 */
export async function GET(_req: NextRequest) {
  try {
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

    const records = await daemonListProviders(userId, tenantId);
    return Response.json({ providers: records.map(toProviderConfig) });
  } catch (err) {
    return translateError(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/settings/providers
// ---------------------------------------------------------------------------

/**
 * Create a new LLM provider config.
 *
 * Request body shape matches DaemonProviderConfigInput:
 *   name         string            (required)
 *   type         string            (required, e.g. "anthropic")
 *   defaultModel string            (required)
 *   credentials  Record<string,string>  (required, plaintext — daemon encrypts immediately)
 *   setAsDefault boolean           (optional)
 *
 * Returns the created provider record with masked credentials.
 * The plaintext credentials transit this handler's memory for one request
 * and are never persisted by the dashboard.
 */
export async function POST(req: NextRequest) {
  let session: Awaited<ReturnType<typeof getServerSession>>;
  try {
    session = await getServerSession();
  } catch (err) {
    return translateError(err);
  }

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
    const record = await daemonCreateProvider(body, userId, tenantId);
    return Response.json({ provider: toProviderConfig(record) }, { status: 201 });
  } catch (err) {
    return translateError(err);
  }
}
