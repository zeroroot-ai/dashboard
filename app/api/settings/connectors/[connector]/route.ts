/**
 * GET    /api/settings/connectors/[connector], the OAuth grant status.
 * DELETE /api/settings/connectors/[connector], disable the connector.
 *
 * Delegation-only through the user-acting transport (userClient).
 */
import 'server-only';
import {
  daemonGetConnectorAuthStatus,
  daemonDisableConnector,
} from '@/src/lib/gibson-client/connectors';
import { connectorErrorResponse } from '@/src/lib/connectors-route-error';

interface RouteContext {
  params: Promise<{ connector: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const { connector } = await params;
  try {
    const auth = await daemonGetConnectorAuthStatus(connector);
    return Response.json({ auth });
  } catch (err) {
    return connectorErrorResponse(err, 'GET /api/settings/connectors/[connector]');
  }
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { connector } = await params;
  try {
    await daemonDisableConnector(connector);
    return Response.json({ ok: true });
  } catch (err) {
    return connectorErrorResponse(err, 'DELETE /api/settings/connectors/[connector]');
  }
}
