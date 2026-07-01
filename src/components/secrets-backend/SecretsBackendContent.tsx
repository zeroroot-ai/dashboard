/**
 * SecretsBackendContent, server component.
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
import {
  getBrokerConfig,
  countSecrets,
} from "@/src/lib/gibson-client/tenant-broker-config";
import type { RedactedConfig } from "@/src/lib/gibson-client/tenant-broker-config";
import { SecretsBackendForm } from "./SecretsBackendForm";

// SECRET_COUNT_UNKNOWN is the sentinel server-side fallback used when the
// daemon's CountSecrets RPC is unreachable. The form treats it as
// equivalent to "secrets present" (conservative, show the migration
// warning) so a transient daemon error never silently hides the warning.
// See spec tenant-secrets-broker-completion R3.6 + design D4.
const SECRET_COUNT_UNKNOWN = -1;

// ---------------------------------------------------------------------------
// Server-side data fetch helpers
// ---------------------------------------------------------------------------

// fetchCurrentState fetches the redacted broker config and the secret
// count in parallel. countSecrets() failure is silent, it falls back to
// SECRET_COUNT_UNKNOWN per Requirement 3.6 so the form renders the
// warning conservatively. getBrokerConfig() failure surfaces in the
// existing daemon-error banner.
async function fetchCurrentState(): Promise<{
  config: RedactedConfig | null;
  secretCount: number;
  error: string | null;
}> {
  const [cfgResult, countResult] = await Promise.allSettled([
    getBrokerConfig(),
    countSecrets(),
  ]);

  let config: RedactedConfig | null = null;
  let error: string | null = null;
  if (cfgResult.status === "fulfilled") {
    const resp = cfgResult.value;
    config = resp?.configured ? (resp.config ?? null) : null;
  } else {
    const reason = cfgResult.reason;
    error = reason instanceof Error ? reason.message : "Failed to load broker config";
  }

  const secretCount =
    countResult.status === "fulfilled"
      ? countResult.value
      : SECRET_COUNT_UNKNOWN;

  return { config, secretCount, error };
}

// ---------------------------------------------------------------------------
// SecretsBackendContent
// ---------------------------------------------------------------------------

export async function SecretsBackendContent() {
  // Auth check, mirrors the pattern from secrets/page.tsx.
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

  const { config, secretCount, error } = await fetchCurrentState();

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
        secretCount={secretCount}
        tenantId={tenantId}
      />
    </div>
  );
}
