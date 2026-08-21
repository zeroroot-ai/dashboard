/**
 * POST /api/settings/connectors/[connector]/authorize, start the OAuth
 * authorization and return the vendor authorize URL the human opens to consent.
 * The daemon holds the PKCE verifier and completes the grant at its callback.
 */
import 'server-only';
import { type NextRequest } from 'next/server';
import { daemonStartConnectorAuthorization } from '@/src/lib/gibson-client/connectors';
import { connectorErrorResponse } from '@/src/lib/connectors-route-error';

interface RouteContext {
  params: Promise<{ connector: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { connector } = await params;
  let instanceUrl = '';
  try {
    const body = (await req.json().catch(() => ({}))) as { instanceUrl?: unknown };
    if (typeof body.instanceUrl === 'string') instanceUrl = body.instanceUrl;
  } catch {
    instanceUrl = '';
  }
  try {
    const authorizeUrl = await daemonStartConnectorAuthorization(connector, instanceUrl);
    return Response.json({ authorizeUrl });
  } catch (err) {
    return connectorErrorResponse(err, 'POST /api/settings/connectors/[connector]/authorize');
  }
}
