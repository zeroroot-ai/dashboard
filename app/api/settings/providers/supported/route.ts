/**
 * GET /api/settings/providers/supported
 *
 * Returns the daemon's static catalogue of supported LLM provider types,
 * with their per-provider credential field schemas. Backs the dashboard's
 * Settings → Providers wizard.
 *
 * Spec: providers-wizard. Daemon RPC:
 *   gibson.tenant.v1.TenantService/GetSupportedProviders
 *
 * Uses the member-accessible client (user's session token). The FGA
 * annotation on GetSupportedProviders carries relation: "member" so any
 * signed-in user — not just tenant admins — can retrieve the static
 * provider catalogue. ADR-0037: migrated from gibson.admin.v1 to the
 * OSS SDK TenantService.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { TenantService } from '@/src/gen/gibson/tenant/v1/tenant_pb';
import { userClient } from '@/src/lib/gibson-client';
import { translateError } from '@/src/lib/providers-route-error';
import type { SupportedProviderDescriptor, CredentialFieldType } from '@/src/lib/gibson-client-types';

export async function GET(_req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  try {
    const client = userClient(TenantService);
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
          // admin/v1 CredentialField predates the `type` field; the wire value
          // is present when the daemon sends it (field 7). Read via assertion.
          fieldType: ((c as unknown as { type?: number }).type ?? 0) as CredentialFieldType,
        })),
        defaultModels: (p.defaultModels ?? []).map((m) => ({
          name: m.name,
          family: m.family ?? '',
          contextWindow: m.contextWindow,
          deprecated: (m as unknown as { deprecated?: boolean }).deprecated ?? false,
        })),
      }),
    );
    return Response.json({ providers });
  } catch (err) {
    return translateError(err);
  }
}
