"use server";

/**
 * setComponentAccessAction — unified Server Action for toggling the
 * deny/grant relations on the extended /dashboard/{agents,tools,plugins}
 * pages plus the new Security Policy matrix. Mirrors the
 * grantComponentAction contract (requireCrdSession gate, ActionResult
 * return, CRD audit emission) so call sites have consistent error
 * handling.
 *
 * Spec: agent-authoring-and-tenant-entitlements task 30, R8 AC 7.
 */

import { TenantAdminService } from "@/src/gen/gibson/admin/v1/tenant_pb";
import { userClient } from "@/src/lib/gibson-client";

import { requireCrdSession } from "./_authz";
import type { ActionResult } from "./types";

export type AccessScope = "tenant" | "team" | "user" | "component" | "my";
export type AccessAction = "read" | "write" | "execute";

export interface SetComponentAccessInput {
  scope: AccessScope;
  /** Required for team / user / component scopes. Ignored for tenant / my. */
  targetId?: string;
  /** Catalog reference, e.g. "plugin:gitlab". */
  componentRef: string;
  action: AccessAction;
  /** true = remove the deny / add the grant; false = install the deny / remove the grant. */
  enabled: boolean;
}

/**
 * Derive the FGA relation name and optional team id for this (scope, action)
 * pair. Returns null when the scope/targetId combination is invalid.
 */
function entryForScope(
  input: SetComponentAccessInput,
  callerTenantId: string,
  callerUserId: string,
): { relation: string; teamId: string; disabled: boolean } | null {
  const { scope, targetId, componentRef, action } = input;
  if (!componentRef) return null;
  const denyRelation = `${action}_disabled`;

  switch (scope) {
    case "tenant":
      // tenant_read/write/execute_disabled — tenant-level, no teamId
      return {
        relation: `tenant_${denyRelation}`,
        teamId: callerTenantId,
        // disabled=true installs the deny; disabled=false removes it
        disabled: !input.enabled,
      };
    case "team":
      if (!targetId) return null;
      return {
        relation: `team_${denyRelation}`,
        teamId: targetId,
        disabled: !input.enabled,
      };
    case "user":
      if (!targetId) return null;
      return {
        relation: `user_${denyRelation}`,
        teamId: targetId,
        disabled: !input.enabled,
      };
    case "my":
      return {
        relation: `user_${denyRelation}`,
        teamId: callerUserId,
        disabled: !input.enabled,
      };
    case "component":
      if (!targetId) return null;
      // component_*_enabled is a grant relation — enabled=true adds it
      return {
        relation: `component_${action}_enabled`,
        teamId: targetId,
        // disabled semantics are inverted for grant relations
        disabled: input.enabled,
      };
  }
}

export async function setComponentAccessAction(
  input: SetComponentAccessInput,
): Promise<ActionResult<{ applied: boolean }>> {
  const gate = await requireCrdSession<{ applied: boolean }>({
    action: "setComponentAccessAction",
    permission: "grants:create",
    inputKeys: ["scope", "targetId", "componentRef", "action", "enabled"],
  });
  if (!gate.ok) return gate.result;
  const callerTenantId = gate.session.user.tenantId;
  const callerUserId = gate.userId;
  if (!callerTenantId) {
    return { ok: false, error: "session missing tenantId", code: "FORBIDDEN" };
  }

  const entry = entryForScope(input, callerTenantId, callerUserId);
  if (!entry) {
    return { ok: false, error: "invalid scope/targetId combination", code: "BAD_INPUT" };
  }

  try {
    const client = userClient(TenantAdminService);
    await client.setComponentAccess({
      tenantId: callerTenantId,
      component: input.componentRef,
      entries: [
        {
          relation: entry.relation,
          teamId: entry.teamId,
          disabled: entry.disabled,
        },
      ],
    });
    return { ok: true, data: { applied: true } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: "INTERNAL",
    };
  }
}
