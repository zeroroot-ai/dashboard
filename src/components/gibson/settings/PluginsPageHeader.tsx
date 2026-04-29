"use client";

/**
 * PluginsPageHeader
 *
 * Header row for the plugins settings page that adds the "Add Plugin" wizard
 * launcher. This component is client-only so it can use hooks for RBAC gating
 * and dialog state.
 *
 * The existing PluginsContent component is rendered separately by the
 * page — this header is injected above it without touching the template logic.
 *
 * Authz: "Add Plugin" button and the PluginRegisterDialog are gated on
 * useAuthorize(RegisterPlugin). Hidden on loading=true (no FOUC).
 * Spec: dashboard-authz-ui-gating Task 12, Requirements 5.2, 5.9.
 *
 * Spec: secrets-tenant-lifecycle Task 15, Requirement 2.3.
 */

import { useAuthorize } from "@/src/lib/auth/use-authorize";
import { PluginRegisterDialog } from "@/src/components/plugin-register/dialog";

export function PluginsPageHeader() {
  // Gate the Add Plugin button (and dialog) on the RegisterPlugin RPC.
  // Hide on loading=true so admin chrome does not flash for non-admins.
  const { allowed, loading } = useAuthorize(
    "/gibson.admin.v1.PluginsAdminService/RegisterPlugin",
  );

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium">Plugins</h3>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Manage installed plugin integrations and register new ones.
        </p>
      </div>
      {!loading && allowed && (
        <PluginRegisterDialog
          onRegistered={() => {
            // Refresh the page to pick up the newly-registered plugin in the
            // PluginsContent list. A hard refresh is appropriate here since
            // PluginsContent manages its own data-fetch lifecycle.
            window.location.reload();
          }}
        />
      )}
    </div>
  );
}
