"use server";

/**
 * Server action for submitting a mission definition from CUE source and
 * creating a mission run.
 *
 * Two-RPC flow per the daemon contract (platform-sdk v0.7.0):
 *   1. DaemonAdminService.CreateMissionDefinition (cue_source case)
 *      — daemon compiles CUE, validates schema, stores definition
 *   2. DaemonService.CreateMission with the returned missionDefinitionId
 *
 * Both RPCs route through Envoy + SPIFFE mTLS via userClient.
 * No direct gRPC channel to the daemon; check-no-direct-daemon-grpc.mjs enforces this.
 */

import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ConnectError, Code } from "@connectrpc/connect";

import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";
import { userClient } from "@/src/lib/gibson-client";
import { DaemonAdminService } from "@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb";
import { DaemonService } from "@/src/gen/gibson/daemon/v1/daemon_pb";
import { logger } from "@/src/lib/logger";

const FGA_CREATE_DEFINITION =
  "/gibson.daemon.admin.v1.DaemonAdminService/CreateMissionDefinition";

export type CreateMissionResult =
  | { ok: true; missionId: string }
  | { ok: false; error: string; code: "permission_denied" | "invalid" | "rpc_failed" };

const inputSchema = z.object({
  cueSource: z
    .string()
    .min(1, "CUE source is required")
    .max(512 * 1024, "CUE source must be at most 512 KB"),
  name: z
    .string()
    .max(256, "Mission name must be at most 256 characters")
    .optional()
    .default("Unnamed Mission"),
});

export async function createMissionFromCUEAction(input: {
  cueSource: string;
  name?: string;
}): Promise<CreateMissionResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "invalid",
    };
  }
  const { cueSource, name } = parsed.data;

  try {
    await assertAuthorized(FGA_CREATE_DEFINITION);
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return { ok: false, error: "Permission denied", code: "permission_denied" };
    }
    throw err;
  }

  try {
    const adminClient = userClient(DaemonAdminService);
    const defResp = await adminClient.createMissionDefinition({
      source: { case: "cueSource", value: cueSource },
    });
    const missionDefinitionId = defResp.missionDefinitionId;
    if (!missionDefinitionId) {
      return {
        ok: false,
        error: "Daemon accepted the definition but returned no ID.",
        code: "rpc_failed",
      };
    }

    const client = userClient(DaemonService);
    const missionResp = await client.createMission({
      name,
      description: "",
      targetId: "",
      missionDefinitionId,
      variables: {},
      memoryContinuity: "isolated",
    });

    const missionId = missionResp.mission?.id;
    if (!missionId) {
      return {
        ok: false,
        error: "Daemon created the mission but returned no ID.",
        code: "rpc_failed",
      };
    }

    return { ok: true, missionId };
  } catch (err) {
    if (err instanceof ConnectError) {
      if (err.code === Code.InvalidArgument) {
        return {
          ok: false,
          error: err.rawMessage || "CUE validation failed",
          code: "invalid",
        };
      }
      logger.warn(
        { rpcCode: err.code, rawMessage: err.rawMessage },
        "createMissionFromCUE: daemon RPC failed",
      );
      return {
        ok: false,
        error: err.rawMessage || "Daemon unavailable — please try again.",
        code: "rpc_failed",
      };
    }
    const msg = err instanceof Error ? err.message : "Unexpected error";
    logger.error({ err: { message: msg } }, "createMissionFromCUE: unexpected error");
    return { ok: false, error: msg, code: "rpc_failed" };
  }
}

const KNOWN_TEMPLATE_IDS = new Set([
  "recon",
  "webapp-scan",
  "secrets-audit",
  "compliance-check",
]);

/**
 * Load the CUE source for a vendored mission template.
 * Template .cue files land in dashboard#293. Returns null gracefully
 * until then so the create page can no-op on ?template=<id>.
 */
export async function getTemplateCUESourceAction(
  templateId: string,
): Promise<string | null> {
  if (!KNOWN_TEMPLATE_IDS.has(templateId)) return null;
  try {
    const path = join(process.cwd(), "src/data/templates", `${templateId}.cue`);
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}
