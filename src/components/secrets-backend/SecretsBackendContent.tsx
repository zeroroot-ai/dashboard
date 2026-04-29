/**
 * SecretsBackendContent — server component.
 *
 * Fetches the current broker config (server-side, via the admin RPC) and
 * passes the redacted config to the client-side SecretsBackendForm. Falls
 * back gracefully when the tenant has no config yet (new tenant default).
 *
 * RBAC: redirects non-admins to the settings root. The daemon enforces
 * tenant_admin on every admin RPC as well (defense in depth).
 *
 * Spec: secrets-tenant-lifecycle Task 13, Requirements 3, 8.1.
 */

import { redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { getServerSession } from "@/src/lib/auth";
import { hasRoleAtLeast } from "@/src/lib/auth/roles";
import { getActiveTenant } from "@/src/lib/auth/active-tenant";
import { getBrokerConfig } from "@/src/lib/gibson-client/tenant-broker-config";
import type { RedactedConfig } from "@/src/lib/gibson-client/tenant-broker-config";
import { SecretsBackendForm } from "./SecretsBackendForm";

// ---------------------------------------------------------------------------
// Server-side data fetch helpers
// ---------------------------------------------------------------------------

async function fetchCurrentConfig(): Promise<{
  config: RedactedConfig | null;
  error: string | null;
}> {
  try {
    const resp = await getBrokerConfig();
    return {
      config: resp.configured ? (resp.config ?? null) : null,
      error: null,
    };
  } catch (err) {
    // Daemon unreachable or auth error — surface a banner, not a crash.
    const msg =
      err instanceof Error ? err.message : "Failed to load broker config";
    return { config: null, error: msg };
  }
}

// ---------------------------------------------------------------------------
// SecretsBackendContent
// ---------------------------------------------------------------------------

export async function SecretsBackendContent() {
  // Auth check — mirrors the pattern from secrets/page.tsx.
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
    redirect("/dashboard/pages/settings");
  }

  const { config, error } = await fetchCurrentConfig();

  // We cannot determine hasExistingSecrets without an additional RPC here;
  // default to true to be conservative (always show the migration warning
  // when the tenant switches providers). The secrets list page Task 10 will
  // fetch the actual count.
  const hasExistingSecrets = true;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium">Secrets Backend</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Choose and configure the provider that stores your tenant&apos;s
          secrets. Gibson-hosted Vault is the default for new SaaS tenants.
          Sensitive credentials are encrypted by the daemon and never returned
          to the dashboard.
        </p>
      </div>

      {/* Daemon error banner */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
      )}

      <SecretsBackendForm
        currentConfig={config}
        hasExistingSecrets={hasExistingSecrets}
      />
    </div>
  );
}
