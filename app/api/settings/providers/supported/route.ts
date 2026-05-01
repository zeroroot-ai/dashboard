/**
 * GET /api/settings/providers/supported
 *
 * Returns the daemon's static catalogue of supported LLM provider types,
 * with their per-provider credential field schemas. Backs the dashboard's
 * Settings → Providers wizard.
 *
 * Spec: providers-wizard. Daemon RPC:
 *   gibson.tenant.v1.TenantAdminService/GetSupportedProviders
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { TenantAdminService } from '@/src/gen/gibson/tenant/v1/tenant_admin_pb';
import { userClient } from '@/src/lib/gibson-client';
import { translateError } from '@/src/lib/providers-route-error';
import type { SupportedProviderDescriptor } from '@/src/lib/gibson-client-types';

export async function GET(_req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  try {
    const client = userClient(TenantAdminService);
    const resp = await client.getSupportedProviders({});
    const providers: SupportedProviderDescriptor[] = (resp.providers ?? []).map(
      (p) => ({
        type: p.type,
        displayName: p.displayName,
        docsUrl: p.docsUrl,
        selfHosted: p.selfHosted,
        credentials: (p.credentials ?? []).map((c) => ({
          key: c.key,
          label: c.label,
          required: c.required,
          secret: c.secret,
          placeholder: c.placeholder,
          help: c.help,
        })),
        defaultModels: (p.defaultModels ?? []).map((m) => ({
          name: m.name,
          family: m.family ?? '',
          contextWindow: m.contextWindow,
        })),
      }),
    );
    return Response.json({ providers });
  } catch (err) {
    return translateError(err);
  }
}
