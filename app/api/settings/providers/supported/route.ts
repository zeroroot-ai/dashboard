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
 * signed-in user, not just tenant admins, can retrieve the static
 * provider catalogue. ADR-0037: migrated from gibson.admin.v1 to the
 * OSS SDK TenantService.
 */

import 'server-only';
import { type NextRequest } from 'next/server';
import { getServerSession } from '@/src/lib/auth';
import { ProviderService } from '@/src/gen/gibson/tenant/v1/provider_pb';
import { userClient } from '@/src/lib/gibson-client';
import { translateError } from '@/src/lib/providers-route-error';
import type { SupportedProviderDescriptor, CredentialFieldType, ModelDescriptor } from '@/src/lib/gibson-client-types';
import { fromProtoCapabilities } from '@/src/lib/provider-capabilities';

/**
 * Map a proto ModelDescriptor to the client-side ModelDescriptor shape.
 * Reads capabilities (field 4, gibson#1072) via direct access since the field
 * is now in the generated type.
 */
function mapModelDescriptor(m: {
  name: string;
  family: string;
  contextWindow: number;
  deprecated?: boolean;
  capabilities?: number[];
}): ModelDescriptor {
  return {
    name: m.name,
    family: m.family ?? '',
    contextWindow: m.contextWindow,
    deprecated: m.deprecated ?? false,
    capabilities: m.capabilities && m.capabilities.length > 0
      ? fromProtoCapabilities(m.capabilities)
      : undefined,
  };
}

export async function GET(_req: NextRequest) {
  const session = await getServerSession();
  if (!session) {
    return Response.json(
      { error: { code: 'unauthenticated', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  try {
    const client = userClient(ProviderService);
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
          // CredentialField.type (field 7) carries the semantic field type.
          fieldType: ((c as unknown as { type?: number }).type ?? 0) as CredentialFieldType,
        })),
        // Chat model catalogue (field 6).
        defaultModels: (p.defaultModels ?? []).map((m) => mapModelDescriptor(m as Parameters<typeof mapModelDescriptor>[0])),
        // Embedding model catalogue from gibson#1072 (field 7).
        // Non-empty for providers that serve embeddings (openai, bedrock, cohere,
        // voyage, openai-compatible, tei). Absent/empty means chat-only.
        embeddingModels: (p.embeddingModels ?? []).length > 0
          ? (p.embeddingModels ?? []).map((m) => mapModelDescriptor(m as Parameters<typeof mapModelDescriptor>[0]))
          : undefined,
      }),
    );
    return Response.json({ providers });
  } catch (err) {
    return translateError(err);
  }
}
