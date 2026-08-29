"use server";

/**
 * Read-only Server Action that fetches the caller's deny-wins-evaluated
 * catalog view from the daemon's DiscoveryService and shapes it into
 * RWXItem objects for the shared dashboard matrix components.
 *
 * Replaces the legacy /api/components/permissions bridge route that
 * fail-opened to enabled=true for every visible item.
 *
 * Spec: agent-authoring-and-tenant-entitlements tasks 30 (Server Action),
 *       33-36 (callers: AgentsContent/ToolsContent/PluginsContent/SecurityPolicy).
 */

import {
  DiscoveryService,
  Scope,
  Action,
} from "@/src/gen/gibson/daemon/discovery/v1/discovery_pb";
import { getServerSession } from "@/src/lib/auth";
import { userClient } from "@/src/lib/gibson-client";

type RWXAction = "read" | "write" | "execute";

export interface DiscoveredItem {
  name: string;
  displayName?: string;
  description?: string;
  kind: "plugin" | "tool" | "agent" | "connector";
  rwx: { read: boolean; write: boolean; execute: boolean };
  denyingGates: string[];
  version?: string;
  /**
   * Deny tuples that EXIST on this item, per scope layer and per action
   * (true = a deny tuple is written). This is what a switch writes, so it is
   * what a switch shows. `rwx` is the effective result, which also needs the
   * catalog and a grant. A layer is absent when the daemon had no subject for
   * it, or when its check failed.
   */
  killSwitches: {
    tenant?: ActionFlags;
    team?: ActionFlags;
    user?: ActionFlags;
  };
  /** tenant_enabled for the caller's tenant, the gate every can_* needs. */
  inTenantCatalog: boolean;
}

export type ActionFlags = { read: boolean; write: boolean; execute: boolean };

function flags(v: unknown): ActionFlags | undefined {
  if (!v || typeof v !== "object") return undefined;
  const f = v as { read?: boolean; write?: boolean; execute?: boolean };
  return { read: !!f.read, write: !!f.write, execute: !!f.execute };
}

type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

interface ListAccessibleComponentsInput {
  kind: "plugin" | "tool" | "agent" | "connector" | "all";
  scope?: "tenant-wide" | "per-team" | "per-user" | "per-agent" | "my-access";
  targetId?: string;
  action?: RWXAction;
}

function mapScope(s?: ListAccessibleComponentsInput["scope"]): Scope {
  switch (s) {
    case "per-team":
      return Scope.TEAM_VIEW;
    case "per-user":
      return Scope.USER_VIEW;
    case "per-agent":
      return Scope.COMPONENT_ENABLED;
    case "my-access":
    case "tenant-wide":
    case undefined:
    default:
      return Scope.USER_ENABLED;
  }
}

function mapAction(a?: RWXAction): Action {
  switch (a) {
    case "read":
      return Action.READ;
    case "write":
      return Action.WRITE;
    case "execute":
      return Action.EXECUTE;
    default:
      return Action.UNSPECIFIED;
  }
}

export async function listAccessibleComponentsAction(
  input: ListAccessibleComponentsInput,
): Promise<ActionResult<DiscoveredItem[]>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }

  const client = userClient(DiscoveryService);
  const query = {
    scope: mapScope(input.scope),
    action: mapAction(input.action),
    targetId: input.targetId ?? "",
    cursor: "",
    pageSize: 500,
  };

  try {
    const out: DiscoveredItem[] = [];
    if (input.kind === "plugin" || input.kind === "all") {
      const r = await client.listPlugins({ query });
      for (const it of r.items) out.push(shape(it, "plugin"));
    }
    if (input.kind === "tool" || input.kind === "all") {
      const r = await client.listTools({ query });
      for (const it of r.items) out.push(shape(it, "tool"));
    }
    if (input.kind === "agent" || input.kind === "all") {
      const r = await client.listAgents({ query });
      for (const it of r.items) out.push(shape(it, "agent"));
    }
    if (input.kind === "connector" || input.kind === "all") {
      const r = await client.listConnectors({ query });
      for (const it of r.items) out.push(shape(it, "connector"));
    }
    return { ok: true, data: out };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// shape converts the proto CatalogItem into the DiscoveredItem the
// dashboard matrix consumes. Everything on CatalogItem is optional on
// the wire so we guard each access.
function shape(item: unknown, kind: DiscoveredItem["kind"]): DiscoveredItem {
  const it = item as {
    name?: string;
    displayName?: string;
    description?: string;
    rwx?: { read?: boolean; write?: boolean; execute?: boolean };
    denyingGates?: string[];
    version?: string;
    killSwitches?: { tenant?: unknown; team?: unknown; user?: unknown };
    inTenantCatalog?: boolean;
  };
  return {
    name: it.name ?? "",
    displayName: it.displayName,
    description: it.description,
    kind,
    rwx: {
      read: !!it.rwx?.read,
      write: !!it.rwx?.write,
      execute: !!it.rwx?.execute,
    },
    denyingGates: it.denyingGates ?? [],
    version: it.version,
    killSwitches: {
      tenant: flags(it.killSwitches?.tenant),
      team: flags(it.killSwitches?.team),
      user: flags(it.killSwitches?.user),
    },
    inTenantCatalog: !!it.inTenantCatalog,
  };
}
