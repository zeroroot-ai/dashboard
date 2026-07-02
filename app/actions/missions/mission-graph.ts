"use server";

/**
 * Server actions for the MissionGraph flow-chart view.
 *
 * The daemon owns the topology projection and the layout store; the dashboard
 * is a pure client. These actions dial the daemon through Envoy + SPIFFE-mTLS
 * via userClient — whose transport registry-gates every RPC with a baked-in
 * assertAuthorized check (dashboard#848 / #902) — and return plain objects
 * safe to cross the server/client boundary (no proto message classes). A
 * denial throws AuthzDeniedError from inside the RPC call; the read actions
 * map it to their graceful empty result (dashboard#904).
 *
 * Spec: MissionGraph epic (sdk#278). Slices dashboard#655 / #657 / #658.
 */

import "server-only";

import { ConnectError, Code } from "@connectrpc/connect";

import { AuthzDeniedError } from "@/src/lib/auth/assert-authorized";
import { userClient } from "@/src/lib/gibson-client";
import { DaemonService } from "@/src/gen/gibson/daemon/v1/daemon_pb";

// ---------------------------------------------------------------------------
// Plain serialisable shapes
// ---------------------------------------------------------------------------

export interface MissionGraphNodeData {
  id: string;
  /** "agent" | "tool" | "plugin" | "condition" | "parallel" | "join" | "unknown" */
  kind: string;
  name: string;
  summary: string;
  isEntry: boolean;
  isExit: boolean;
  rank: number;
  x: number;
  y: number;
  /** "saved" | "auto" */
  layoutSource: string;
}

export interface MissionGraphEdgeData {
  from: string;
  to: string;
  condition: string;
  /** "" | "true" | "false" */
  role: string;
}

export interface ViewportData {
  x: number;
  y: number;
  zoom: number;
}

export interface MissionGraphData {
  nodes: MissionGraphNodeData[];
  edges: MissionGraphEdgeData[];
  entryPoints: string[];
  exitPoints: string[];
  viewport: ViewportData | null;
}

interface NodePositionInput {
  nodeId: string;
  x: number;
  y: number;
}

interface SaveLayoutInput {
  missionDefinitionId: string;
  nodes: NodePositionInput[];
  viewport?: ViewportData | null;
  /** Echo the version from the last get/save; empty for the first save. */
  expectedVersion: string;
}

type SaveLayoutResult =
  | { ok: true; version: string }
  | { ok: false; conflict: true };

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Fetch the daemon-projected flow-chart graph for a mission definition. Returns
 * null when the caller is not authorized to view it.
 */
export async function getMissionGraphAction(
  missionDefinitionId: string,
): Promise<MissionGraphData | null> {
  try {
    const client = userClient(DaemonService);
    const resp = await client.getMissionGraph({ missionDefinitionId });
    const g = resp.graph;
    if (!g) return null;

    return {
      nodes: g.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        name: n.name,
        summary: n.summary,
        isEntry: n.isEntry,
        isExit: n.isExit,
        rank: n.rank,
        x: n.x,
        y: n.y,
        layoutSource: n.layoutSource,
      })),
      edges: g.edges.map((e) => ({
        from: e.from,
        to: e.to,
        condition: e.condition,
        role: e.role,
      })),
      entryPoints: [...g.entryPoints],
      exitPoints: [...g.exitPoints],
      viewport: g.viewport
        ? { x: g.viewport.x, y: g.viewport.y, zoom: g.viewport.zoom }
        : null,
    };
  } catch (err) {
    if (err instanceof AuthzDeniedError) return null;
    throw err;
  }
}

/** The saved layout's opaque version token, or "" when none is saved. */
export async function getMissionLayoutVersionAction(
  missionDefinitionId: string,
): Promise<string> {
  try {
    const client = userClient(DaemonService);
    const resp = await client.getMissionLayout({ missionDefinitionId });
    return resp.layout?.version ?? "";
  } catch (err) {
    if (err instanceof AuthzDeniedError) return "";
    throw err;
  }
}

/**
 * Persist a hand-arranged layout. Layout-only, never touches the mission
 * definition. A stale write (the layout changed underneath) returns
 * `{ ok: false, conflict: true }` rather than throwing, so the UI can prompt a
 * reload.
 */
export async function saveMissionLayoutAction(
  input: SaveLayoutInput,
): Promise<SaveLayoutResult> {
  // Authz denial (AuthzDeniedError from the userClient transport) is
  // deliberately NOT mapped here: it propagates to the caller, matching the
  // previous bare-assert behaviour.
  const client = userClient(DaemonService);
  try {
    const resp = await client.saveMissionLayout({
      layout: {
        missionDefinitionId: input.missionDefinitionId,
        nodes: input.nodes.map((p) => ({
          nodeId: p.nodeId,
          x: p.x,
          y: p.y,
        })),
        viewport: input.viewport
          ? { x: input.viewport.x, y: input.viewport.y, zoom: input.viewport.zoom }
          : undefined,
      },
      expectedVersion: input.expectedVersion,
    });
    return { ok: true, version: resp.version };
  } catch (err) {
    if (ConnectError.from(err).code === Code.Aborted) {
      return { ok: false, conflict: true };
    }
    throw err;
  }
}
