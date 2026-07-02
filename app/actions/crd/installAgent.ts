"use server";

/**
 * installAgentAction, all-or-nothing agent install write path.
 *
 * Re-validates the manifest server-side, intersects the requested
 * permissions with the caller's current access, mints a tenant-scoped
 * `agent_principal` id, and batch-writes `component_*_enabled` tuples via
 * TenantAdminService.GrantComponentPermissions. The server enforces
 * caller-access intersection, only capabilities the caller already holds
 * may be forwarded to the agent principal. The grant is atomic server-side
 * so no client-side compensating delete is needed.
 *
 * Defence-in-depth: we refuse to write a tuple the caller lacks access to,
 * regardless of what `permissions.yaml` declared required.
 *
 * Spec: access-matrix-finish task 13, R5 AC 1-4, 6, 9.
 * Migration: dashboard#359, write path moved to userClient(TenantAdminService).
 */

import { randomUUID } from "node:crypto";

import { MembershipService } from "@/src/gen/gibson/tenant/v1/membership_pb";
import { DiscoveryService } from "@/src/gen/gibson/daemon/discovery/v1/discovery_pb";
import { userClient } from "@/src/lib/gibson-client";
import { requireActiveTenant } from "@/src/lib/auth/active-tenant";
import {
  listAccessibleComponentsAction,
  type DiscoveredItem,
} from "@/app/actions/read/listAccessibleComponents";

import { requireCrdSession } from "./_authz";
import type {
  InstallAction,
  InstallAgentInput,
} from "./installAgent.types";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function hasAccess(
  accessible: DiscoveredItem[],
  target: string,
  action: InstallAction,
): boolean {
  // target is like "component:plugin/gitlab"; accessible rows carry
  // `kind` + `name`, so compose the expected ref for a fair compare.
  const match = accessible.find((d) => {
    return (
      target === `component:${d.kind}/${d.name}` ||
      target === `component:${d.name}`
    );
  });
  if (!match) return false;
  return match.rwx[action] === true;
}

export async function installAgentAction(
  input: InstallAgentInput,
): Promise<ActionResult<{ agentInstallationId: string }>> {
  const gate = await requireCrdSession<{ agentInstallationId: string }>({
    action: "installAgentAction",
    inputKeys: ["agentSlug", "approvals"],
  });
  if (!gate.ok) {
    return { ok: false, error: gate.result.ok ? "" : gate.result.error };
  }
  let tenantId: string;
  try {
    tenantId = await requireActiveTenant();
  } catch {
    return { ok: false, error: "no active tenant" };
  }

  // 1. Re-validate the manifest server-side (defence in depth).
  const validate = await userClient(DiscoveryService).validateComponent({
    componentYaml: new TextEncoder().encode(input.componentYaml),
    permissionsYaml: new TextEncoder().encode(input.permissionsYaml),
  });
  if (!validate.ok) {
    return {
      ok: false,
      error: `manifest re-validation failed (${
        validate.schemaErrors.length
      } schema, ${validate.accessErrors.length} access errors)`,
    };
  }

  // 2. Intersect against caller's current access. Any approval for a
  //    (target, action) the caller lacks must be refused before we mint a
  //    principal or touch FGA, prevents a compromised manifest from
  //    widening access.
  const accessible = await listAccessibleComponentsAction({ kind: "all" });
  if (!accessible.ok) {
    return {
      ok: false,
      error: `access check failed: ${accessible.error}`,
    };
  }
  const denied = input.approvals.filter(
    (a) => !hasAccess(accessible.data, a.target, a.action),
  );
  if (denied.length > 0) {
    const list = denied
      .map((d) => `${d.target}:${d.action}`)
      .join(", ");
    return {
      ok: false,
      error: `cannot grant what you lack: ${list}`,
    };
  }

  // 3. Mint the agent-installation principal (tenant-scoped UUIDv4 so
  //    FGA tuple collisions are impossible across tenants).
  const installationId = `${randomUUID()}-${tenantId}`;

  // 4. Build the component approval list.
  const approvals = input.approvals.map((a) => ({
    target: a.target,
    action: a.action,
  }));
  if (approvals.length === 0) {
    // Nothing to grant, approvals list may have been empty intentionally.
    return { ok: true, data: { agentInstallationId: installationId } };
  }

  // 5. Atomic grant, server enforces caller-access intersection server-side.
  //    No client-side compensating delete needed; the RPC is all-or-nothing.
  try {
    await userClient(MembershipService).grantComponentPermissions({
      agentInstallationId: installationId,
      approvals,
      reason: `agent install: ${input.agentSlug}`,
    });
    return { ok: true, data: { agentInstallationId: installationId } };
  } catch (err) {
    return {
      ok: false,
      error: `install failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
