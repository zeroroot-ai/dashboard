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

import { getDaemonAdminClient } from "@/src/lib/gibson-admin-client";

import { requireCrdSession } from "./_authz";
import type { ActionResult } from "./types";

export type { ActionResult };

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
 * Compute the FGA tuple that expresses the requested change for this
 * (scope, action) pair. The caller's tenant is baked into the subject
 * for tenant-scope denies; other scopes use the explicit target.
 */
function tupleForScope(
  input: SetComponentAccessInput,
  callerTenantId: string,
  callerUserId: string,
): { user: string; relation: string; object: string } | null {
  const { scope, targetId, componentRef, action } = input;
  if (!componentRef) return null;
  const denyRelation = `${action === "write" ? "write" : action}_disabled`;
  const grantRelation = `component_${action === "write" ? "write" : action}_enabled`;
  switch (scope) {
    case "tenant":
      return {
        user: `tenant:${callerTenantId}`,
        relation: `tenant_${denyRelation}`,
        object: componentRef,
      };
    case "team":
      if (!targetId) return null;
      return {
        user: `team:${targetId}#member`,
        relation: `team_${denyRelation}`,
        object: componentRef,
      };
    case "user":
      if (!targetId) return null;
      return {
        user: `user:${targetId}`,
        relation: `user_${denyRelation}`,
        object: componentRef,
      };
    case "my":
      return {
        user: `user:${callerUserId}`,
        relation: `user_${denyRelation}`,
        object: componentRef,
      };
    case "component":
      if (!targetId) return null;
      return {
        user: `agent_principal:${targetId}`,
        relation: grantRelation,
        object: componentRef,
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

  const tuple = tupleForScope(input, callerTenantId, callerUserId);
  if (!tuple) {
    return { ok: false, error: "invalid scope/targetId combination", code: "BAD_INPUT" };
  }

  // For deny-style tuples: enabled=true removes the tuple (re-enables
  // access), enabled=false adds the tuple (installs the deny). For
  // grant-style component_*_enabled: enabled=true adds the grant,
  // enabled=false removes it.
  const isGrant = tuple.relation.startsWith("component_");
  const wantAdd = isGrant ? input.enabled : !input.enabled;

  try {
    const client = getDaemonAdminClient();
    if (wantAdd) {
      await client.writeAccessTuples({
        add: [tuple],
        delete: [],
        reason: `dashboard: ${input.scope} ${input.action} ${input.enabled ? "enable" : "deny"}`,
      });
    } else {
      await client.writeAccessTuples({
        add: [],
        delete: [tuple],
        reason: `dashboard: ${input.scope} ${input.action} revert`,
      });
    }
    return { ok: true, data: { applied: true } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      code: "INTERNAL",
    };
  }
}
