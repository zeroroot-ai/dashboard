/**
 * GET /api/admin/components/catalog — components available to the
 * caller's tenant.
 *
 * ADR-0037: ListCatalogComponents was removed from TenantService. This
 * route returns an empty components list for now. A replacement RPC is
 * tracked at dashboard#336.
 *
 * Spec: component-bootstrap-dashboard-completion Requirement 2.
 */

import 'server-only';

import { NextResponse } from 'next/server';

import { auth } from '@/auth';

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

  // ListCatalogComponents deleted in ADR-0037 — return empty list gracefully.
  // A replacement RPC that surfaces the catalog to member-level callers is
  // tracked at dashboard#336.
  const components: CatalogComponentDTO[] = [];
  return NextResponse.json({ components }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
