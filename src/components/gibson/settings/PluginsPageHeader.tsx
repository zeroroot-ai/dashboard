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
 * Spec: secrets-tenant-lifecycle Task 15, Requirement 2.3.
 */

import { usePermitted } from "@/src/lib/auth/tenant";
import { PluginRegisterDialog } from "@/src/components/plugin-register/dialog";

export function PluginsPageHeader() {
  // Gate the Add Plugin button on tenant_admin permission
  const canManage = usePermitted("components:manage");

  return (
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-medium">Plugins</h3>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Manage installed plugin integrations and register new ones.
        </p>
      </div>
      {canManage && (
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
