import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { getServerSession } from "@/src/lib/auth";
import { getActiveTenant } from "@/src/lib/auth/active-tenant";
import { listSecrets } from "@/src/lib/gibson-client/secrets";
import { getBrokerConfig } from "@/src/lib/gibson-client/tenant-broker-config";
import { type BrokerProvider } from "@/src/gen/gibson/tenant/v1/secrets_pb";
import { resolveSecretsBackendView } from "@/src/lib/secrets/page-state";
import { SecretsList } from "@/src/components/secrets/SecretsList";
import { SecretsEmptyState } from "@/src/components/secrets/EmptyState";
import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings | Secrets",
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

  try {
    await getActiveTenant();
  } catch {
    redirect("/select-tenant");
  }

  // Authz: ListSecrets is tenant_member, so all members can view the list.
  // Non-members are redirected. Spec: dashboard-authz-ui-gating Task 14.
  try {
    await assertAuthorized("/gibson.tenant.v1.SecretsService/ListSecrets");
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      redirect("/dashboard/pages/settings");
    }
    throw err;
  }

  const params = await searchParams;
  const offset = Math.max(0, parseInt(params.offset ?? "0", 10) || 0);
  const limit = Math.min(100, Math.max(1, parseInt(params.limit ?? String(PAGE_LIMIT), 10) || PAGE_LIMIT));

  // Determine the active backend from the daemon's explicit signal. Hosted is
  // the always-active default for every tenant, so the add-secret path stays
  // reachable whenever the broker responds; a genuine "unavailable" state is
  // shown only when the broker cannot be reached. No provider/address
  // heuristics (dashboard#935).
  let brokerReachable = false;
  let activeProvider: BrokerProvider | undefined;
  try {
    const brokerResp = await getBrokerConfig();
    brokerReachable = true;
    activeProvider = brokerResp.config?.provider;
  } catch {
    brokerReachable = false;
  }

  const view = resolveSecretsBackendView({
    reachable: brokerReachable,
    provider: activeProvider,
  });

  if (view === "unavailable") {
    return (
      <div className="space-y-6">
        <div className="space-y-0.5">
          <h3 className="text-lg font-semibold">Secrets</h3>
          <p className="text-muted-foreground text-sm">
            Manage credentials and API keys your plugins can resolve at mission time.
          </p>
        </div>
        <SecretsEmptyState variant="unavailable" />
      </div>
    );
  }

  const isBYO = view === "byo";

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
        <SecretsEmptyState variant={isBYO ? "no-secrets" : "onboarding"} />
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
