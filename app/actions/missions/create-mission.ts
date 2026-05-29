"use server";

/**
 * Server action for submitting a mission definition from CUE source and
 * creating a mission run.
 *
 * Three-RPC flow (sdk v0.121.0 / ADR-0037):
 *   1. DaemonService.ValidateMissionCUE — daemon compiles CUE, returns
 *      diagnostics AND the compiled MissionDefinition proto. Any diagnostics
 *      abort submission.
 *   2. DaemonService.CreateMissionDefinition — register the compiled definition,
 *      receive a missionDefinitionId.
 *   3. DaemonService.CreateMission — create a mission run referencing the
 *      definition and the targetRef from the compiled definition.
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
import { DaemonService } from "@/src/gen/gibson/daemon/v1/daemon_pb";
import { logger } from "@/src/lib/logger";

const FGA_CREATE_DEFINITION =
  "/gibson.daemon.v1.DaemonService/CreateMissionDefinition";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUUID(s: string): boolean {
  return UUID_RE.test(s);
}

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
  const { cueSource } = parsed.data;

  try {
    await assertAuthorized(FGA_CREATE_DEFINITION);
  } catch (err) {
    if (err instanceof AuthzDeniedError) {
      return { ok: false, error: "Permission denied", code: "permission_denied" };
    }
    throw err;
  }

  try {
    const client = userClient(DaemonService);

    // Step 1: Validate and compile. Diagnostics (including missing 'mission'
    // field) abort submission. compiledDefinition is populated on success.
    const validateResp = await client.validateMissionCUE({ cueSource });
    if (validateResp.diagnostics && validateResp.diagnostics.length > 0) {
      const firstError = validateResp.diagnostics[0];
      return {
        ok: false,
        error: firstError?.message ?? "CUE validation failed",
        code: "invalid",
      };
    }
    const compiledDefinition = validateResp.compiledDefinition;
    if (!compiledDefinition) {
      return {
        ok: false,
        error: "Compilation returned no definition — check your CUE source.",
        code: "rpc_failed",
      };
    }

    // Step 2: Register the mission definition, iteration-safe. Re-running an
    // edited mission under the same name is the normal path, not an error:
    // CreateMissionDefinition is keyed by name and returns AlreadyExists when
    // the definition is already registered, so we fall back to
    // UpdateMissionDefinition (gibson#437) to overwrite it in place under its
    // stable id. cueSource is passed on both so the daemon persists the
    // author's exact CUE (gibson#504), which GetMissionDefinition returns for
    // the editor's load path.
    let missionDefinitionId: string;
    try {
      const defResp = await client.createMissionDefinition({
        definition: compiledDefinition,
        cueSource,
      });
      if (!defResp.missionDefinitionId) {
        return {
          ok: false,
          error: "Daemon did not return a mission definition ID.",
          code: "rpc_failed",
        };
      }
      missionDefinitionId = defResp.missionDefinitionId;
    } catch (defErr) {
      if (defErr instanceof ConnectError && defErr.code === Code.AlreadyExists) {
        const updateResp = await client.updateMissionDefinition({
          definition: compiledDefinition,
          cueSource,
        });
        if (!updateResp.missionDefinitionId) {
          return {
            ok: false,
            error: "Daemon did not return a mission definition ID on update.",
            code: "rpc_failed",
          };
        }
        missionDefinitionId = updateResp.missionDefinitionId;
      } else {
        throw defErr;
      }
    }

    // Step 3: Resolve the target to a UUID (UUID-canonical contract). A target
    // is referenced by UUID only — a name is never used as an id.
    //
    //   - targetRef is already a target UUID (the editor's picker writes one):
    //     use it directly.
    //   - targetRef is a free-form host/name: mint a real Target from it as
    //     metadata (the automatic pre-step) and use the daemon-assigned UUID.
    //   - targetRef is empty: no target was attached — fail with a clear,
    //     actionable message instead of leaking a name into target_id.
    const targetRef = (compiledDefinition.targetRef ?? "").trim();
    if (!targetRef) {
      return {
        ok: false,
        error: "Attach a target before running this mission.",
        code: "invalid",
      };
    }
    let targetId: string;
    if (isUUID(targetRef)) {
      targetId = targetRef;
    } else {
      const targetResp = await client.createTarget({
        target: { name: targetRef, url: targetRef },
      });
      if (!targetResp.targetId) {
        return {
          ok: false,
          error: "Failed to register the mission target.",
          code: "rpc_failed",
        };
      }
      targetId = targetResp.targetId;
    }

    // Step 4: Dispatch + execute the mission. RunMission is what actually runs
    // it — the daemon find-or-creates the run record (keyed by definition),
    // stamps the tenant, and streams lifecycle events. We read the first event
    // to confirm dispatch, then return the running mission's id; the detail
    // page's SSE relay carries the remaining frames. (Previously this called
    // CreateMission, which only registered a pending record and never ran it —
    // missions sat stuck in Pending forever.)
    let runMissionId = "";
    for await (const event of client.runMission({
      missionDefinitionId,
      targetId,
      memoryContinuity: "isolated",
    })) {
      runMissionId = event.missionId;
      break;
    }
    if (!runMissionId) {
      return {
        ok: false,
        error: "Mission dispatch returned no run id.",
        code: "rpc_failed",
      };
    }

    return { ok: true, missionId: runMissionId };
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
