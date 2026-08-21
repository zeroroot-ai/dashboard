/**
 * POST /api/settings/connectors/[connector]/revoke, revoke the connector's
 * OAuth grant. Subsequent tool calls fail until the connector is re-authorized.
 */
import 'server-only';
import { type NextRequest } from 'next/server';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
import { daemonRevokeConnectorGrant } from '@/src/lib/gibson-client/connectors';
import { connectorErrorResponse } from '@/src/lib/connectors-route-error';

interface RouteContext {
  params: Promise<{ connector: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  // CSRF: mutating handler must verify the double-submit token (src/lib/auth/csrf.ts).
  try {
    await requireCsrf(req);
  } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }

  const { connector } = await params;
  try {
    await daemonRevokeConnectorGrant(connector);
    return Response.json({ ok: true });
  } catch (err) {
    return connectorErrorResponse(err, 'POST /api/settings/connectors/[connector]/revoke');
  }
}
