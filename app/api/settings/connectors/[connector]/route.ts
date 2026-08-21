/**
 * GET    /api/settings/connectors/[connector], the OAuth grant status.
 * DELETE /api/settings/connectors/[connector], disable the connector.
 *
 * Delegation-only through the user-acting transport (userClient).
 */
import 'server-only';
import { type NextRequest } from 'next/server';
import { CsrfError, csrfErrorResponse, requireCsrf } from '@/src/lib/auth/csrf';
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

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  // CSRF: mutating handler must verify the double-submit token (src/lib/auth/csrf.ts).
  try {
    await requireCsrf(req);
  } catch (err) {
    if (err instanceof CsrfError) return csrfErrorResponse(err);
    throw err;
  }

  const { connector } = await params;
  try {
    await daemonDisableConnector(connector);
    return Response.json({ ok: true });
  } catch (err) {
    return connectorErrorResponse(err, 'DELETE /api/settings/connectors/[connector]');
  }
}
