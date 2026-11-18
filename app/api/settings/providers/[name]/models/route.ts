// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * GET /api/settings/providers/[name]/models, list the models of a SAVED provider
 *
 * Delegates to the daemon ListProviderModels RPC. The daemon sends one GET of
 * the model list through the route of the provider on the model gateway, and
 * caches a good list for 5 minutes. A failed call is a 200 with ok false and an
 * errorClass: route_not_ready, auth_failed, rate_limited, timeout, network or
 * unknown. The provider wizard polls this route until the class is no longer
 * route_not_ready.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { requireActiveTenant, activeTenantApiResponse } from '@/src/lib/auth/active-tenant';
import { daemonListProviderModels } from '@/src/lib/gibson-client';
import { translateError } from '@/src/lib/providers-route-error';

type RouteContext = { params: Promise<{ name: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  const { name } = await params;
  const userId = session.user.id;
  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch (err) {
    return activeTenantApiResponse(err);
  }

  try {
    const result = await daemonListProviderModels(name, userId, tenantId);
    return Response.json({ result });
  } catch (err) {
    return translateError(err);
  }
}
