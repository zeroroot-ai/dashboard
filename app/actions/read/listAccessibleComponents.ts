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

import { createGrpcTransport } from "@connectrpc/connect-node";
import { createClient, type Interceptor } from "@connectrpc/connect";
import {
  DiscoveryService,
  Scope,
  Action,
} from "@/src/gen/gibson/daemon/discovery/v1/discovery_pb";
import { getServerSession } from "@/src/lib/auth";
import { getSpiffeJwt } from "@/src/lib/spiffe/jwt-svid";

export type RWXAction = "read" | "write" | "execute";

export interface DiscoveredItem {
  name: string;
  displayName?: string;
  description?: string;
  kind: "plugin" | "tool" | "agent";
  rwx: { read: boolean; write: boolean; execute: boolean };
  denyingGates: string[];
  version?: string;
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ListAccessibleComponentsInput {
  kind: "plugin" | "tool" | "agent" | "all";
  scope?: "tenant-wide" | "per-team" | "per-user" | "per-agent" | "my-access";
  targetId?: string;
  action?: RWXAction;
}

// Envoy edge gateway — see `dashboard-admin-via-envoy` spec. The direct
// daemon URL was removed; `scripts/check-no-direct-daemon-grpc.mjs` fails
// the build if anyone reintroduces it.
const ENVOY_BASE_URL =
  process.env.ADMIN_ENVOY_BASE_URL ?? "https://api.zero-day.local:30443";

const DAEMON_AUDIENCE =
  process.env.GIBSON_DAEMON_SPIFFE_AUDIENCE ??
  "spiffe://gibson.io/platform/daemon";

const spiffeJwtInterceptor: Interceptor = (next) => async (req) => {
  const jwt = await getSpiffeJwt({ audience: DAEMON_AUDIENCE });
  req.header.set("Authorization", `Bearer ${jwt}`);
  return next(req);
};

let cachedClient: ReturnType<typeof createClient<typeof DiscoveryService>> | null = null;

function discoveryClient() {
  if (cachedClient) return cachedClient;
  const transport = createGrpcTransport({
    baseUrl: ENVOY_BASE_URL,
    interceptors: [spiffeJwtInterceptor],
  });
  cachedClient = createClient(DiscoveryService, transport);
  return cachedClient;
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

  const client = discoveryClient();
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
  };
}
