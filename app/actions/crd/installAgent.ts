"use server";

/**
 * installAgentAction — all-or-nothing agent install write path.
 *
 * Re-validates the manifest server-side, intersects the requested
 * permissions with the caller's current access, mints a tenant-scoped
 * `agent_principal` id, and batch-writes `component_*_enabled` tuples via
 * DaemonOperatorService.WriteAccessTuples. On any failure, issues a
 * compensating delete before surfacing the error.
 *
 * Defence-in-depth: we refuse to write a tuple the caller lacks access to,
 * regardless of what `permissions.yaml` declared required.
 *
 * Spec: access-matrix-finish task 13, R5 AC 1-4, 6, 9.
 * Migration: admin-services-completion task 16 — WriteAccessTuples moved to
 * DaemonOperatorService.
 */

import { randomUUID } from "node:crypto";

import { DaemonOperatorService } from "@/src/gen/gibson/daemon/operator/v1/operator_pb";
import { DiscoveryService } from "@/src/gen/gibson/daemon/discovery/v1/discovery_pb";
import { serviceClient } from "@/src/lib/gibson-client";
import {
  listAccessibleComponentsAction,
  type DiscoveredItem,
} from "@/app/actions/read/listAccessibleComponents";

import { requireCrdSession } from "./_authz";
import type {
  InstallAction,
  InstallApproval,
  InstallAgentInput,
} from "./installAgent.types";

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function relationFor(action: InstallAction): string {
  return `component_${action}_enabled`;
}

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
    permission: "grants:create",
    inputKeys: ["agentSlug", "approvals"],
  });
  if (!gate.ok) {
    return { ok: false, error: gate.result.ok ? "" : gate.result.error };
  }
  const tenantId = gate.session.user.tenantId ?? "";
  if (!tenantId) {
    return { ok: false, error: "no tenant in session" };
  }

  // 1. Re-validate the manifest server-side (defence in depth).
  const validate = await serviceClient(DiscoveryService, tenantId).validateComponent({
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
  //    principal or touch FGA — prevents a compromised manifest from
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
  const principal = `agent_principal:${installationId}`;

  // 4. Build the batched tuple writes.
  const tuples = input.approvals.map((a) => ({
    user: principal,
    relation: relationFor(a.action),
    object: a.target,
  }));
  if (tuples.length === 0) {
    // Nothing to grant — approvals list may have been empty intentionally.
    return { ok: true, data: { agentInstallationId: installationId } };
  }

  // 5. All-or-nothing: compensating delete on any batch failure.
  const client = serviceClient(DaemonOperatorService, tenantId);
  try {
    await client.writeAccessTuples({
      add: tuples,
      delete: [],
      reason: `agent install: ${input.agentSlug}`,
    });
    return { ok: true, data: { agentInstallationId: installationId } };
  } catch (err) {
    // Best-effort rollback — ignore rollback failure (the error surfaced
    // to the user already names the compensating attempt).
    try {
      await client.writeAccessTuples({
        add: [],
        delete: tuples,
        reason: `agent install rollback: ${input.agentSlug}`,
      });
    } catch {
      // swallow
    }
    return {
      ok: false,
      error: `install rolled back: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
