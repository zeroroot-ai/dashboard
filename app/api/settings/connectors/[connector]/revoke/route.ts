/**
 * POST /api/settings/connectors/[connector]/revoke, revoke the connector's
 * OAuth grant. Subsequent tool calls fail until the connector is re-authorized.
 */
import 'server-only';
import { daemonRevokeConnectorGrant } from '@/src/lib/gibson-client/connectors';
import { connectorErrorResponse } from '@/src/lib/connectors-route-error';

interface RouteContext {
  params: Promise<{ connector: string }>;
}

export async function POST(_req: Request, { params }: RouteContext) {
  const { connector } = await params;
  try {
    await daemonRevokeConnectorGrant(connector);
    return Response.json({ ok: true });
  } catch (err) {
    return connectorErrorResponse(err, 'POST /api/settings/connectors/[connector]/revoke');
  }
}
