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
  /** What the row IS, who holds it, and when it last checked in. */
  provenance: Provenance;
}

export type ComponentSource = "platform-catalog" | "tenant-enrolled" | "unknown";

export interface Provenance {
  source: ComponentSource;
  /** The tenant the registry holds it under ("_system" for platform items). */
  ownerTenant?: string;
  /** Registered instances right now. */
  instances: number;
  /** Newest heartbeat across instances. Undefined when nothing is registered. */
  lastHeartbeat?: Date;
  /** Oldest running instance's start. */
  startedAt?: Date;
}

function sourceOf(v: unknown): ComponentSource {
  // protobuf-es decodes the enum to its numeric value; JSON transport may
  // carry the name. Accept both, and never guess on anything else.
  if (v === 1 || v === "SOURCE_PLATFORM_CATALOG") return "platform-catalog";
  if (v === 2 || v === "SOURCE_TENANT_ENROLLED") return "tenant-enrolled";
  return "unknown";
}

function unixDate(v: unknown): Date | undefined {
  const n = typeof v === "bigint" ? Number(v) : typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return n > 0 ? new Date(n * 1000) : undefined;
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
    source?: unknown;
    ownerTenant?: string;
    instances?: number;
    lastHeartbeatUnix?: unknown;
    startedAtUnix?: unknown;
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
    provenance: {
      source: sourceOf(it.source),
      ownerTenant: it.ownerTenant || undefined,
      instances: it.instances ?? 0,
      lastHeartbeat: unixDate(it.lastHeartbeatUnix),
      startedAt: unixDate(it.startedAtUnix),
    },
  };
}
