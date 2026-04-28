/**
 * GET /api/settings/providers/supported
 *
 * GetSupportedProviders has been DELETED per admin-services-completion spec
 * (design.md disposition: Bucket C, no caller). The RPC no longer exists on
 * any service. This route returns 410 Gone so any stale client code fails
 * clearly.
 *
 * Provider form rendering should use the provider list from ListProviders
 * (which returns existing configurations) rather than a separate descriptor
 * endpoint.
 */

import { type NextRequest } from 'next/server';

export async function GET(_req: NextRequest) {
  return Response.json(
    { error: { code: 'gone', message: 'GetSupportedProviders removed in admin-services-completion' } },
    { status: 410 },
  );
}
