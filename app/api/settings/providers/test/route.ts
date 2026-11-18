// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * POST /api/settings/providers/test, test a SAVED provider
 *
 * Body: { name: string }. The name is the name of a provider that the tenant
 * already saved. The daemon sends one GET of the model list through the route
 * of the provider on the model gateway. No credential crosses this handler:
 * the daemon reads the saved credential itself. An unsaved name gives 404.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import {
  daemonTestProvider,
} from '@/src/lib/gibson-client';
import { translateError } from '@/src/lib/providers-route-error';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';

// ---------------------------------------------------------------------------
// POST /api/settings/providers/test
// ---------------------------------------------------------------------------

/** Read the name from the JSON body. Any other field is ignored, never forwarded. */
async function readProviderName(req: NextRequest): Promise<string | null> {
  try {
    const body = (await req.json()) as { name?: unknown };
    return typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Returns a DaemonProviderTestResult:
 *   ok         boolean , true when the model list answered
 *   latencyMs  number  , round-trip time in milliseconds
 *   model      string  , the default model of the provider (when ok is true)
 *   error      string? , the reason (when ok is false)
 *   models     the live model list (when ok is true)
 *
 * A failed call is a 200 with ok false. The daemon answers
 * "the route of the provider is not ready yet" until the tenant operator
 * creates the route after the save.
 */
export async function POST(req: NextRequest) {
  // CSRF, src/lib/auth/csrf.ts: the session cookie is sameSite=lax, so a
  // mutating handler must check the double-submit token itself.
  try {
    await requireCsrf(req);
  } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }

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

  const name = await readProviderName(req);
  if (!name) {
    return Response.json(
      { error: { code: 'invalid_argument', message: 'The body must be JSON with the name of a saved provider' } },
      { status: 400 },
    );
  }

  try {
    const result = await daemonTestProvider(name, userId, tenantId);
    return Response.json({ result });
  } catch (err) {
    return translateError(err);
  }
}
