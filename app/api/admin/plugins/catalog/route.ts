/**
 * GET /api/admin/plugins/catalog, plugins available to the caller's
 * tenant. Same daemon RPC as the components catalog; this endpoint
 * projects only the plugin set.
 *
 * ADR-0037: ListCatalogComponents was removed from TenantService. This
 * route returns an empty plugins list for now. A replacement RPC is
 * tracked at dashboard#336.
 *
 * Spec: component-bootstrap-dashboard-completion Requirement 2.
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { auth } from '@/auth';

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

  // ListCatalogComponents deleted in ADR-0037, return empty list gracefully.
  // A replacement RPC that surfaces the catalog to member-level callers is
  // tracked at dashboard#336.
  const plugins: CatalogPluginDTO[] = [];
  return NextResponse.json({ plugins }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
