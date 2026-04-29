import { type Metadata } from "next";
import { redirect } from "next/navigation";
import { generateMeta } from "@/lib/utils";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldIcon } from "lucide-react";

import { listActiveGrants } from "@/src/lib/gibson-client/grants";
import { GrantsTable } from "@/src/components/grants/GrantsTable";
import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";

/**
 * Grants inspector page — server component.
 *
 * Fetches the tenant's active capability grants via the read-only
 * ListActiveGrants admin RPC, then delegates rendering to the client-side
 * GrantsTable component which provides recipient-class and RPC filters.
 *
 * RBAC: gated on tenant#admin by the daemon's ext-authz. A 403 from the
 * daemon will surface as an error state below.
 *
 * Read-only — no revoke surface in v1 per Requirement 4.2.
 *
 * Spec: secrets-tenant-lifecycle Task 16, Requirement 4.
 */

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "Settings — Grants",
    additionalTitle: true,
    description:
      "Inspect active capability grants for your tenant. Read-only view of in-flight authorizations.",
    canonical: "/pages/settings/grants",
  });
}

export default async function GrantsPage() {
  // Defense-in-depth: block direct URL navigation by non-admins even if the
  // sidebar entry is hidden. Spec: dashboard-authz-ui-gating Task 16, Req 5.7.
  try {
    await assertAuthorized("/gibson.admin.v1.GrantsAdminService/ListActiveGrants");
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      redirect("/dashboard/pages/settings");
    }
    throw err;
  }

  let grants: Awaited<ReturnType<typeof listActiveGrants>>["grants"] = [];
  let loadError: string | null = null;

  try {
    const resp = await listActiveGrants({ limit: 100 });
    grants = resp.grants ?? [];
  } catch (err) {
    loadError =
      err instanceof Error ? err.message : "Failed to load capability grants.";
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start gap-3">
        <ShieldIcon className="mt-0.5 size-5 text-muted-foreground shrink-0" aria-hidden="true" />
        <div className="space-y-0.5">
          <h3 className="text-base font-semibold leading-none tracking-tight">
            Capability Grants
          </h3>
          <p className="text-sm text-muted-foreground">
            Active capability-grant JWTs for your tenant. Read-only — grants are
            managed by the daemon during mission dispatch.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Active grants</CardTitle>
          <CardDescription className="text-xs">
            Grants nearing expiry (within 5 minutes) are highlighted in amber.
            Filters narrow the displayed rows client-side.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <p className="font-medium">Failed to load grants</p>
              <p className="mt-1 text-xs opacity-80">{loadError}</p>
            </div>
          ) : (
            <GrantsTable grants={grants} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
