/**
 * GET /api/admin/plugins/catalog — plugins available to the caller's
 * tenant. Same daemon RPC as the components catalog; this endpoint
 * projects only the plugin set.
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

export interface CatalogPluginDTO {
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

  let plugins: CatalogPluginDTO[];
  try {
    const client = userClient(TenantAdminService);
    const resp = await client.listCatalogComponents({});
    plugins = resp.plugins.map((p) => ({
      name: p.name,
      ref: p.ref,
      description: p.description,
      version: p.version,
    }));
  } catch (err) {
    console.error('[plugins/catalog] daemon RPC failed:', err instanceof Error ? err.name : typeof err);
    return NextResponse.json(
      { error: { code: 'DAEMON_ERROR', message: 'Failed to list catalog plugins' } },
      { status: 502 },
    );
  }

  return NextResponse.json({ plugins }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
