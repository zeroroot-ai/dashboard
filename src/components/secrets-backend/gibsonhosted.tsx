"use client";

/**
 * GibsonHostedForm — read-only panel for the Gibson-hosted Vault provider.
 *
 * No configuration fields are shown because Gibson manages the Vault cluster
 * and namespace on behalf of the tenant. The component only confirms that the
 * managed backend is active.
 *
 * Spec: secrets-tenant-lifecycle Task 13, Requirement 3.
 */

import { CheckCircle2, DatabaseZapIcon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

export function GibsonHostedForm() {
  return (
    <div className="space-y-4">
      <Alert>
        <DatabaseZapIcon className="size-4" />
        <AlertDescription className="text-xs">
          Your secrets are stored in a dedicated HashiCorp Vault namespace
          managed by Gibson. No configuration is required — the backend is
          ready to use.
        </AlertDescription>
      </Alert>

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 className="size-4 text-green-500 shrink-0" />
        Gibson-hosted Vault is active for your tenant.
      </div>
    </div>
  );
}
