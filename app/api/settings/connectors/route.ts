/**
 * GET  /api/settings/connectors, the curated catalog plus the tenant's enabled
 *      connectors with live status.
 * POST /api/settings/connectors, enable a catalog connector by catalogId.
 *
 * Delegation-only. The daemon ConnectorService RPCs run through the user-acting
 * transport (userClient), which enforces the per-RPC authorization check, so no
 * authorization logic lives here.
 */
import 'server-only';
import { type NextRequest } from 'next/server';
import {
  daemonListCatalog,
  daemonListConnectors,
  daemonEnableConnector,
} from '@/src/lib/gibson-client/connectors';
import { connectorErrorResponse } from '@/src/lib/connectors-route-error';

export async function GET() {
  try {
    const [catalog, enabled] = await Promise.all([daemonListCatalog(), daemonListConnectors()]);
    return Response.json({ catalog, enabled });
  } catch (err) {
    return connectorErrorResponse(err, 'GET /api/settings/connectors');
  }
}

export async function POST(req: NextRequest) {
  let catalogId: string;
  try {
    const body = (await req.json()) as { catalogId?: unknown };
    if (typeof body.catalogId !== 'string' || body.catalogId.length === 0) {
      return Response.json(
        { error: { code: 'invalid_argument', message: 'catalogId is required.' } },
        { status: 400 },
      );
    }
    catalogId = body.catalogId;
  } catch {
    return Response.json(
      { error: { code: 'invalid_argument', message: 'A JSON body with catalogId is required.' } },
      { status: 400 },
    );
  }
  try {
    await daemonEnableConnector(catalogId);
    return Response.json({ ok: true }, { status: 201 });
  } catch (err) {
    return connectorErrorResponse(err, 'POST /api/settings/connectors');
  }
}
