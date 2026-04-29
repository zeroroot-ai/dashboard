import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { getServerSession } from "@/src/lib/auth";
import { hasRoleAtLeast } from "@/src/lib/auth/roles";
import { getActiveTenant } from "@/src/lib/auth/active-tenant";
import { listSecrets } from "@/src/lib/gibson-client/secrets";
import { getBrokerConfig } from "@/src/lib/gibson-client/tenant-broker-config";
import { BrokerProvider } from "@/src/gen/gibson/admin/v1/tenant_pb";
import { SecretsList } from "@/src/components/secrets/SecretsList";
import { SecretsEmptyState } from "@/src/components/secrets/EmptyState";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings — Secrets",
    additionalTitle: true,
    description: "Manage credentials and configuration secrets for your tenant.",
    canonical: "/pages/settings/secrets",
  });
}

const PAGE_LIMIT = 25;

interface SecretsPageProps {
  searchParams: Promise<{ offset?: string; limit?: string }>;
}

export default async function SecretsPage({ searchParams }: SecretsPageProps) {
  // Auth check
  const session = await getServerSession();
  if (!session?.user) {
    redirect("/login");
  }

  let tenantId: string;
  try {
    tenantId = await getActiveTenant();
  } catch {
    redirect("/select-tenant");
  }

  if (!hasRoleAtLeast(session, tenantId, "admin")) {
    // Non-admins see a 403-equivalent; redirect to settings root.
    redirect("/dashboard/pages/settings");
  }

  const params = await searchParams;
  const offset = Math.max(0, parseInt(params.offset ?? "0", 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit ?? String(PAGE_LIMIT), 10) || PAGE_LIMIT));

  // Determine broker state first — drives the empty state variant.
  let brokerConfigured = false;
  let isGibsonHosted = false;
  try {
    const brokerResp = await getBrokerConfig();
    brokerConfigured = brokerResp.configured;
    // Gibson-hosted Vault is BROKER_PROVIDER_VAULT with no explicit address
    // (the platform sets it) — we infer "gibson-hosted" by the provider enum
    // and absence of a custom address. The platform always uses Vault, so any
    // VAULT provider with no custom address is Gibson-hosted.
    isGibsonHosted =
      brokerConfigured &&
      brokerResp.config?.provider === BrokerProvider.VAULT &&
      !brokerResp.config?.address;
  } catch {
    // If the broker config call fails, treat as unconfigured — safe default.
    brokerConfigured = false;
  }

  if (!brokerConfigured) {
    return (
      <div className="space-y-6">
        <div className="space-y-0.5">
          <h3 className="text-lg font-semibold">Secrets</h3>
          <p className="text-muted-foreground text-sm">
            Manage credentials and API keys your plugins can resolve at mission time.
          </p>
        </div>
        <SecretsEmptyState variant="no-broker" />
      </div>
    );
  }

  // Fetch the secrets list.
  let secrets: Awaited<ReturnType<typeof listSecrets>> | null = null;
  let fetchError: string | null = null;
  try {
    secrets = await listSecrets({ offset, limit });
  } catch (err) {
    fetchError = err instanceof Error ? err.message : "Failed to load secrets";
  }

  const hasSecrets = (secrets?.secrets.length ?? 0) > 0;
  const total = secrets?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="space-y-0.5">
          <h3 className="text-lg font-semibold">Secrets</h3>
          <p className="text-muted-foreground text-sm">
            Manage credentials and API keys your plugins can resolve at mission time.
            Values are write-only and never displayed.
          </p>
        </div>
      </div>

      {fetchError ? (
        <p className="text-destructive text-sm">{fetchError}</p>
      ) : !hasSecrets ? (
        <SecretsEmptyState variant={isGibsonHosted ? "onboarding" : "no-secrets"} />
      ) : (
        <SecretsList
          secrets={secrets!.secrets}
          total={total}
          offset={offset}
          limit={limit}
          basePath="/dashboard/pages/settings/secrets"
        />
      )}
    </div>
  );
}
