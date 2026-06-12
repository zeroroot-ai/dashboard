"use server";

/**
 * Server actions for the mission-create page's draft persistence flow.
 *
 * Each action: (1) calls assertAuthorized against the corresponding daemon
 * RPC's authz registry entry; (2) resolves the active tenant server-side via
 * getActiveTenant, never accepts a tenantId from the client; (3) invokes
 * the daemon RPC through the Envoy + SPIFFE-mTLS path; (4) maps daemon
 * NotFound to a typed DraftNotFound error so the UI can show a "draft
 * expired" toast.
 *
 * Spec: mission-draft-dashboard-wiring.
 */

import "server-only";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import {
  saveMissionDraft as rpcSave,
  listMissionDrafts as rpcList,
  getMissionDraft as rpcGet,
  deleteMissionDraft as rpcDelete,
  MissionDraftNotFoundError,
  MissionDraftRpcError,
  type MissionDraft,
  type MissionDraftFull,
} from "@/src/lib/gibson-client/mission-source";
import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";
import { getActiveTenant } from "@/src/lib/auth/active-tenant";
import { logger } from "@/src/lib/logger";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DraftActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: DraftActionErrorCode };

export type DraftActionErrorCode =
  | "permission_denied"
  | "bad_input"
  | "not_found"
  | "rpc_failed";

// ---------------------------------------------------------------------------
// FGA registry keys (mirror the daemon's authz annotations)
// ---------------------------------------------------------------------------

const FGA_SAVE = "/gibson.tenant.v1.TenantService/SaveMissionDraft";
const FGA_LIST = "/gibson.tenant.v1.TenantService/ListMissionDrafts";
const FGA_GET = "/gibson.tenant.v1.TenantService/GetMissionDraft";
const FGA_DELETE = "/gibson.tenant.v1.TenantService/DeleteMissionDraft";

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const saveSchema = z.object({
  name: z
    .string()
    .min(1, "Draft name is required")
    .max(256, "Draft name must be at most 256 characters")
    .trim(),
  cueSource: z
    .string()
    .min(1, "Draft CUE source is required")
    .max(512 * 1024, "Draft CUE source must be at most 512 KB"),
  draftId: z.string().max(128).optional(),
});

const idSchema = z
  .string()
  .min(1, "draftId is required")
  .max(128, "draftId must be at most 128 characters");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapDeniedOrThrow(err: unknown): DraftActionResult<never> | never {
  if (err instanceof AuthzDeniedError) {
    return { ok: false, error: "Permission denied", code: "permission_denied" };
  }
  throw err;
}

function rpcErrToResult(action: string, err: unknown): DraftActionResult<never> {
  if (err instanceof MissionDraftNotFoundError) {
    return { ok: false, error: "Draft not found", code: "not_found" };
  }
  if (err instanceof MissionDraftRpcError) {
    logger.warn(
      { action, rpcCode: err.code },
      "mission-draft action: rpc failed",
    );
    return {
      ok: false,
      error: "Could not reach the daemon, please try again.",
      code: "rpc_failed",
    };
  }
  // Unexpected error type, preserve stack via re-throw at callsite if needed.
  logger.error(
    { action, err: err instanceof Error ? { message: err.message } : err },
    "mission-draft action: unexpected error",
  );
  return {
    ok: false,
    error: "An unexpected error occurred.",
    code: "rpc_failed",
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Persists a mission CUE draft for the active tenant. When draftId is
 * provided the existing draft is overwritten in place; otherwise a new
 * draft is created and its server-assigned ID is returned.
 */
export async function saveMissionSourceAction(input: {
  name: string;
  cueSource: string;
  draftId?: string;
}): Promise<DraftActionResult<{ draftId: string }>> {
  try {
    await assertAuthorized(FGA_SAVE);
  } catch (err) {
    const denied = mapDeniedOrThrow(err);
    if (denied) return denied;
  }

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
      code: "bad_input",
    };
  }

  const tenantId = await getActiveTenant();
  try {
    const { draftId } = await rpcSave(tenantId, parsed.data);
    revalidatePath("/dashboard/missions/create");
    return { ok: true, data: { draftId } };
  } catch (err) {
    return rpcErrToResult("saveMissionDraft", err);
  }
}

/**
 * Returns the metadata-only list of saved drafts for the active tenant,
 * ordered by update time descending. CUE source is not included.
 */
export async function listMissionSourcesAction(): Promise<
  DraftActionResult<MissionDraft[]>
> {
  try {
    await assertAuthorized(FGA_LIST);
  } catch (err) {
    const denied = mapDeniedOrThrow(err);
    if (denied) return denied;
  }

  const tenantId = await getActiveTenant();
  try {
    const drafts = await rpcList(tenantId);
    return { ok: true, data: drafts };
  } catch (err) {
    return rpcErrToResult("listMissionDrafts", err);
  }
}

/**
 * Returns the full draft (including CUE source) for the given draftId scoped
 * to the active tenant. Maps daemon NotFound to "not_found" so the page can
 * strip a stale ?draft=<id> from the URL and toast "draft expired."
 */
export async function getMissionSourceAction(
  draftId: string,
): Promise<DraftActionResult<MissionDraftFull>> {
  try {
    await assertAuthorized(FGA_GET);
  } catch (err) {
    const denied = mapDeniedOrThrow(err);
    if (denied) return denied;
  }

  const idValid = idSchema.safeParse(draftId);
  if (!idValid.success) {
    return {
      ok: false,
      error: idValid.error.issues[0]?.message ?? "Invalid draftId",
      code: "bad_input",
    };
  }

  const tenantId = await getActiveTenant();
  try {
    const draft = await rpcGet(tenantId, idValid.data);
    return { ok: true, data: draft };
  } catch (err) {
    return rpcErrToResult("getMissionDraft", err);
  }
}

/**
 * Removes a draft scoped to the active tenant. Idempotent on the daemon
 * side, deleting a missing draft returns OK.
 */
export async function deleteMissionSourceAction(
  draftId: string,
): Promise<DraftActionResult<null>> {
  try {
    await assertAuthorized(FGA_DELETE);
  } catch (err) {
    const denied = mapDeniedOrThrow(err);
    if (denied) return denied;
  }

  const idValid = idSchema.safeParse(draftId);
  if (!idValid.success) {
    return {
      ok: false,
      error: idValid.error.issues[0]?.message ?? "Invalid draftId",
      code: "bad_input",
    };
  }

  const tenantId = await getActiveTenant();
  try {
    await rpcDelete(tenantId, idValid.data);
    revalidatePath("/dashboard/missions/create");
    return { ok: true, data: null };
  } catch (err) {
    return rpcErrToResult("deleteMissionDraft", err);
  }
}
