"use client";

/**
 * permission-gate.tsx, Declarative permission gating for UI elements
 *
 * Reads the permissions cache and conditionally renders children.
 * SSR-safe: renders `fallback` during loading so the server can hydrate
 * without flicker. The cache is populated client-side after mount.
 *
 * Supported `required` formats:
 *   "is_admin"                , requires isAdmin === true
 *   "can_execute:tool:nmap"   , requires action on componentRef
 *   "can_read:agent:opencode" , similar
 *   "can_write:plugin:gitlab" , similar
 *
 * Usage:
 *   <PermissionGate tenantId={tenantId} required="is_admin">
 *     <AdminButton />
 *   </PermissionGate>
 *
 *   <PermissionGate tenantId={tenantId} required="can_execute:tool:nmap" fallback={<span>No access</span>}>
 *     <RunButton />
 *   </PermissionGate>
 *
 * Requirements: 7.4, 7.5
 */

import * as React from "react";
import { useMyPermissions } from "@/src/lib/permissions-cache";

interface PermissionGateProps {
  /** The tenant to check permissions for */
  tenantId: string;
  /**
   * Permission spec. One of:
   * - "is_admin"
   * - "<action>:<kind>:<name>" e.g. "can_execute:tool:nmap"
   */
  required: string;
  /** Rendered when the user has the required permission */
  children: React.ReactNode;
  /**
   * Rendered when the user lacks the permission (after loading completes).
   * Defaults to null (nothing rendered).
   */
  fallback?: React.ReactNode;
  /**
   * Rendered while the permissions cache is loading.
   * Defaults to null (nothing rendered, avoids FOUC).
   */
  loadingFallback?: React.ReactNode;
}

/**
 * Parse a permission spec string into a structured check request.
 */
function parseRequired(spec: string): { kind: "admin" } | { kind: "component"; action: string; ref: string } {
  if (spec === "is_admin") return { kind: "admin" };
  // Format: "<action>:<componentKind>:<componentName>"
  const parts = spec.split(":");
  if (parts.length >= 3) {
    const action = parts[0];
    const componentRef = parts.slice(1).join(":");
    return { kind: "component", action, ref: componentRef };
  }
  // Unrecognized format, default to deny
  return { kind: "component", action: "", ref: "" };
}

export function PermissionGate({
  tenantId,
  required,
  children,
  fallback = null,
  loadingFallback = null,
}: PermissionGateProps) {
  const { permissions, loading } = useMyPermissions(tenantId);

  if (loading || !permissions) {
    return <>{loadingFallback}</>;
  }

  const check = parseRequired(required);

  let allowed = false;

  if (check.kind === "admin") {
    allowed = permissions.isAdmin;
  } else if (check.kind === "component") {
    if (permissions.isAdmin) {
      // Admins inherit all grants
      allowed = true;
    } else {
      const grant = permissions.componentGrants.find(
        (g) => g.componentRef === check.ref,
      );
      allowed = grant?.actions.includes(check.action) ?? false;
    }
  }

  return <>{allowed ? children : fallback}</>;
}
