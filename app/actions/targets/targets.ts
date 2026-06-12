"use server";

/**
 * Server actions for first-class target management (UUID-canonical).
 *
 * A target is identified by a server-minted UUID; name and the other fields are
 * metadata. These actions wrap the customer-facing DaemonService target RPCs
 * (CreateTarget / GetTarget / ListTargets / UpdateTarget / DeleteTarget) and
 * route through Envoy + SPIFFE mTLS via userClient, never a direct daemon
 * channel.
 */

import "server-only";

import { ConnectError } from "@connectrpc/connect";

import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";
import { userClient } from "@/src/lib/gibson-client";
import { DaemonService } from "@/src/gen/gibson/daemon/v1/daemon_pb";
import { logger } from "@/src/lib/logger";

const FGA_CREATE_TARGET = "/gibson.daemon.v1.DaemonService/CreateTarget";
const FGA_LIST_TARGETS = "/gibson.daemon.v1.DaemonService/ListTargets";
const FGA_GET_TARGET = "/gibson.daemon.v1.DaemonService/GetTarget";
const FGA_UPDATE_TARGET = "/gibson.daemon.v1.DaemonService/UpdateTarget";
const FGA_DELETE_TARGET = "/gibson.daemon.v1.DaemonService/DeleteTarget";

/** TargetView is the metadata surface the dashboard reads/writes. */
export interface TargetView {
  id: string;
  name: string;
  type: string;
  url: string;
  provider: string;
  model: string;
  authType: string;
  status: string;
  description: string;
  tags: string[];
  capabilities: string[];
  timeout: number;
}

/** TargetInput is the author-supplied metadata for create/update. */
export interface TargetInput {
  name: string;
  type?: string;
  url?: string;
  provider?: string;
  model?: string;
  authType?: string;
  status?: string;
  description?: string;
  tags?: string[];
  capabilities?: string[];
  timeout?: number;
}

export type TargetActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code: "permission_denied" | "invalid" | "not_found" | "rpc_failed";
    };

// toView maps a wire Target (or undefined) into the dashboard's metadata view.
function toView(t: {
  id?: string;
  name?: string;
  type?: string;
  url?: string;
  provider?: string;
  model?: string;
  authType?: string;
  status?: string;
  description?: string;
  tags?: string[];
  capabilities?: string[];
  timeout?: number;
}): TargetView {
  return {
    id: t.id ?? "",
    name: t.name ?? "",
    type: t.type ?? "",
    url: t.url ?? "",
    provider: t.provider ?? "",
    model: t.model ?? "",
    authType: t.authType ?? "",
    status: t.status ?? "",
    description: t.description ?? "",
    tags: t.tags ?? [],
    capabilities: t.capabilities ?? [],
    timeout: t.timeout ?? 0,
  };
}

// targetMsg builds the wire Target init from author input (shared by create/update).
function targetMsg(input: TargetInput): {
  name: string;
  type: string;
  url: string;
  provider: string;
  model: string;
  authType: string;
  status: string;
  description: string;
  tags: string[];
  capabilities: string[];
  timeout: number;
} {
  return {
    name: input.name,
    type: input.type ?? "",
    url: input.url ?? "",
    provider: input.provider ?? "",
    model: input.model ?? "",
    authType: input.authType ?? "",
    status: input.status ?? "",
    description: input.description ?? "",
    tags: input.tags ?? [],
    capabilities: input.capabilities ?? [],
    timeout: input.timeout ?? 0,
  };
}

// mapErr converts a thrown error into a structured failure result.
function mapErr(err: unknown, op: string): {
  ok: false;
  error: string;
  code: "permission_denied" | "invalid" | "not_found" | "rpc_failed";
} {
  if (err instanceof AuthzDeniedError) {
    return { ok: false, error: "Permission denied", code: "permission_denied" };
  }
  if (err instanceof ConnectError) {
    logger.warn({ op, rpcCode: err.code, rawMessage: err.rawMessage }, "target action RPC failed");
    return { ok: false, error: err.rawMessage || "Target operation failed", code: "rpc_failed" };
  }
  const msg = err instanceof Error ? err.message : "Unexpected error";
  logger.error({ op, err: { message: msg } }, "target action unexpected error");
  return { ok: false, error: msg, code: "rpc_failed" };
}

export async function createTargetAction(
  input: TargetInput,
): Promise<TargetActionResult<TargetView>> {
  if (!input?.name?.trim()) {
    return { ok: false, error: "Target name is required", code: "invalid" };
  }
  try {
    await assertAuthorized(FGA_CREATE_TARGET);
    const client = userClient(DaemonService);
    const resp = await client.createTarget({ target: targetMsg(input) });
    if (!resp.target?.id && !resp.targetId) {
      return { ok: false, error: "Daemon did not return a target", code: "rpc_failed" };
    }
    return { ok: true, data: toView(resp.target ?? { id: resp.targetId }) };
  } catch (err) {
    return mapErr(err, "createTarget");
  }
}

export async function listTargetsAction(filter?: {
  provider?: string;
  type?: string;
  status?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}): Promise<TargetActionResult<TargetView[]>> {
  try {
    await assertAuthorized(FGA_LIST_TARGETS);
    const client = userClient(DaemonService);
    const resp = await client.listTargets({
      filter: {
        provider: filter?.provider ?? "",
        type: filter?.type ?? "",
        status: filter?.status ?? "",
        tags: filter?.tags ?? [],
        limit: filter?.limit ?? 0,
        offset: filter?.offset ?? 0,
      },
    });
    return { ok: true, data: (resp.targets ?? []).map(toView) };
  } catch (err) {
    return mapErr(err, "listTargets");
  }
}

export async function getTargetAction(
  targetId: string,
): Promise<TargetActionResult<TargetView>> {
  if (!targetId) {
    return { ok: false, error: "target id is required", code: "invalid" };
  }
  try {
    await assertAuthorized(FGA_GET_TARGET);
    const client = userClient(DaemonService);
    const resp = await client.getTarget({ targetId });
    if (!resp.target) {
      return { ok: false, error: "Target not found", code: "not_found" };
    }
    return { ok: true, data: toView(resp.target) };
  } catch (err) {
    return mapErr(err, "getTarget");
  }
}

export async function updateTargetAction(
  targetId: string,
  input: TargetInput,
): Promise<TargetActionResult<TargetView>> {
  if (!targetId) {
    return { ok: false, error: "target id is required", code: "invalid" };
  }
  if (!input?.name?.trim()) {
    return { ok: false, error: "Target name is required", code: "invalid" };
  }
  try {
    await assertAuthorized(FGA_UPDATE_TARGET);
    const client = userClient(DaemonService);
    const resp = await client.updateTarget({
      target: { id: targetId, ...targetMsg(input) },
    });
    return { ok: true, data: toView(resp.target ?? { id: targetId }) };
  } catch (err) {
    return mapErr(err, "updateTarget");
  }
}

export async function deleteTargetAction(
  targetId: string,
): Promise<TargetActionResult<{ id: string }>> {
  if (!targetId) {
    return { ok: false, error: "target id is required", code: "invalid" };
  }
  try {
    await assertAuthorized(FGA_DELETE_TARGET);
    const client = userClient(DaemonService);
    await client.deleteTarget({ targetId });
    return { ok: true, data: { id: targetId } };
  } catch (err) {
    return mapErr(err, "deleteTarget");
  }
}
