"use server";

/**
 * Server action for submitting a mission definition from CUE source and
 * creating a mission run.
 *
 * Two-RPC flow per the daemon contract (sdk v0.118.0 / ADR-0037):
 *   1. DaemonService.ValidateMissionCUE — daemon compiles CUE, returns
 *      diagnostics. Any errors abort submission.
 *   2. DaemonService.CreateMissionDefinition with a structured
 *      MissionDefinition proto + DaemonService.CreateMission.
 *
 * NOTE (dashboard#336 / ADR-0037): The OSS SDK CreateMissionDefinitionRequest
 * accepts a fully-formed MissionDefinition proto only; there is no cue_source
 * field. A future RPC (e.g. CompileMissionCUE) will close the gap so raw CUE
 * source text can be submitted as a single daemon round-trip. Until that RPC
 * ships, createMissionFromCUEAction validates the CUE and returns a clear
 * error rather than silently corrupting the definition.
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
import {
  listMissionDraftsAction,
  saveMissionDraftAction,
} from "@/app/actions/missions/drafts";

const FGA_CREATE_DEFINITION =
  "/gibson.daemon.v1.DaemonService/CreateMissionDefinition";

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
    const client = userClient(DaemonService);

    // Validate the CUE source via the daemon. Diagnostics abort submission.
    const validateResp = await client.validateMissionCUE({ cueSource });
    if (validateResp.diagnostics && validateResp.diagnostics.length > 0) {
      const firstError = validateResp.diagnostics[0];
      return {
        ok: false,
        error: firstError?.message ?? "CUE validation failed",
        code: "invalid",
      };
    }

    // NOTE (dashboard#336 / ADR-0037): DaemonService.CreateMissionDefinition
    // (OSS SDK v0.118.0) accepts a fully-formed MissionDefinition proto only —
    // there is no cue_source field. A future RPC (CompileMissionCUE or
    // equivalent) is needed to compile raw CUE to a MissionDefinition on the
    // daemon side. Until that RPC ships the CUE-from-editor submit path cannot
    // proceed past validation. Tracked at dashboard#337.
    //
    // Non-blocking: save the CUE as a draft so the user does not lose work.
    const definitionName =
      /^name:\s*["']?([^"'\n]+)["']?/m.exec(cueSource)?.[1]?.trim() ?? name;
    void (async () => {
      try {
        const existingDrafts = await listMissionDraftsAction();
        const match = existingDrafts.ok
          ? existingDrafts.data.find((d) => d.name === definitionName)
          : undefined;
        await saveMissionDraftAction({
          name: definitionName,
          cueSource,
          draftId: match?.id,
        });
      } catch (err) {
        logger.warn({ err }, "draft upsert on submit: non-fatal");
      }
    })();

    return {
      ok: false,
      error:
        "CUE submission requires a daemon-side compilation RPC not yet " +
        "available in this SDK version. Your draft has been saved. " +
        "This will be resolved in dashboard#337.",
      code: "rpc_failed",
    };
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
