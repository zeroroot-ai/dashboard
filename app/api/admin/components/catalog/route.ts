/**
 * GET /api/admin/components/catalog — components available to the
 * caller's tenant.
 *
 * Calls TenantAdminService.ListCatalogComponents through Envoy +
 * ext-authz; returns the components projection. Used by the deploy
 * wizard's Permissions step and the agent / tool detail Permissions
 * tab's add-grant modal.
 *
 * Spec: component-bootstrap-dashboard-completion Requirement 2.
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { auth } from '@/auth';
import { userClient } from '@/src/lib/gibson-client';
import { TenantAdminService } from '@/src/gen/gibson/tenant/v1/tenant_admin_pb';
import {
  assertAuthorized,
  AuthzDeniedError,
} from '@/src/lib/auth/assert-authorized';

export interface CatalogComponentDTO {
  name: string;
  ref: string;
  description: string;
  version: string;
}

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  try {
    await assertAuthorized('/gibson.tenant.v1.TenantAdminService/ListCatalogComponents');
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return NextResponse.json(
        { error: { code: 'FORBIDDEN', message: 'Permission denied' } },
        { status: 403 },
      );
    }
    throw err;
  }

  let components: CatalogComponentDTO[];
  try {
    const client = userClient(TenantAdminService);
    const resp = await client.listCatalogComponents({});
    components = resp.components.map((c) => ({
      name: c.name,
      ref: c.ref,
      description: c.description,
      version: c.version,
    }));
  } catch (err) {
    console.error('[components/catalog] daemon RPC failed:', err instanceof Error ? err.name : typeof err);
    return NextResponse.json(
      { error: { code: 'DAEMON_ERROR', message: 'Failed to list catalog components' } },
      { status: 502 },
    );
  }

  return NextResponse.json({ components }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
