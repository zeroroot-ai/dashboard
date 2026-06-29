"use server";

/**
 * checkpoint-actions.ts, Server actions backing the Checkpoint Browser UI.
 *
 * Wraps the daemon's `DaemonService.ListCheckpoints` / `GetCheckpoint` /
 * `DiffCheckpoints` / `ResumeMission` RPCs so client components can call
 * them through the sanctioned Envoy + ext-authz + SPIFFE-mTLS path
 * (`userClient(...)`) without importing `gibson-client` directly.
 *
 * Spec:
 *   - mission-checkpointing R13 (List), R14 (Get), R15 (Diff), R17 (UI),
 *     R9 (Resume + checkpoint metadata).
 *   - week-4-handlers-ui-e2e §4 tasks 35-46 (dashboard checkpoint browser).
 *
 * Security:
 *   - assertAuthorized runs server-side defence-in-depth before each call.
 *     The daemon + ext-authz are still authoritative; this layer just
 *     short-circuits unauthorized callers earlier.
 *   - Errors are logged via the canonical pino logger and re-thrown as
 *     plain {@link CheckpointActionError} objects with a serialisable
 *     `code` so the client can render gRPC-aware toasts.
 */

import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";

import { logger } from "@/src/lib/logger";
import { getServerSession } from "@/src/lib/auth";
import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";
import { userClient } from "@/src/lib/gibson-client";
import { DaemonService } from "@/src/gen/gibson/daemon/v1/daemon_pb";
import {
  ListCheckpointsRequestSchema,
  GetCheckpointRequestSchema,
  DiffCheckpointsRequestSchema,
  ResumeMissionRequestSchema,
  ListCheckpointsRequest_Order,
  type ListCheckpointsResponse,
  type GetCheckpointResponse,
  type DiffCheckpointsResponse,
  type CheckpointMetadata,
} from "@/src/gen/gibson/daemon/v1/daemon_pb";

const LIST_METHOD = "/gibson.daemon.v1.DaemonService/ListCheckpoints";
const GET_METHOD = "/gibson.daemon.v1.DaemonService/GetCheckpoint";
const DIFF_METHOD = "/gibson.daemon.v1.DaemonService/DiffCheckpoints";
const RESUME_METHOD = "/gibson.daemon.v1.DaemonService/ResumeMission";

// ---------------------------------------------------------------------------
// Public error shape
// ---------------------------------------------------------------------------

/**
 * Serialisable error payload returned to the client when a checkpoint
 * action fails. The shape is plain JSON so it survives the Server Action
 * boundary without losing the gRPC status code.
 */
export interface CheckpointActionError {
  ok: false;
  /** Numeric Connect/gRPC status code. */
  code: number;
  /** Symbolic name of the code (e.g. "permission_denied"). */
  codeName: string;
  /** User-safe message; never includes role/tenant data. */
  message: string;
}

function toActionError(err: unknown, fallback: string): CheckpointActionError {
  if (err instanceof AuthzDeniedError) {
    return {
      ok: false,
      code: Code.PermissionDenied,
      codeName: "permission_denied",
      message: "Permission denied",
    };
  }
  if (err instanceof ConnectError) {
    return {
      ok: false,
      code: err.code,
      codeName: Code[err.code]
        ? `${Code[err.code]}`.toLowerCase()
        : "unknown",
      message: err.rawMessage || fallback,
    };
  }
  return {
    ok: false,
    code: Code.Unknown,
    codeName: "unknown",
    message: fallback,
  };
}

// ---------------------------------------------------------------------------
// ListCheckpoints
// ---------------------------------------------------------------------------

export type ListCheckpointsActionResult =
  | { ok: true; response: ListCheckpointsResponse }
  | CheckpointActionError;

interface ListCheckpointsActionInput {
  missionId: string;
  pageSize?: number;
  pageToken?: string;
  order?: "newest_first" | "oldest_first";
}

/** Daemon `ListCheckpoints` wrapper, paginated, RBAC-scoped. */
export async function listCheckpointsAction(
  input: ListCheckpointsActionInput,
): Promise<ListCheckpointsActionResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      ok: false,
      code: Code.Unauthenticated,
      codeName: "unauthenticated",
      message: "Authentication required",
    };
  }

  try {
    await assertAuthorized(LIST_METHOD);

    const order =
      input.order === "oldest_first"
        ? ListCheckpointsRequest_Order.OLDEST_FIRST
        : ListCheckpointsRequest_Order.NEWEST_FIRST;

    const req = create(ListCheckpointsRequestSchema, {
      missionId: input.missionId,
      pageSize: input.pageSize ?? 50,
      pageToken: input.pageToken ?? "",
      order,
    });

    const response = await userClient(DaemonService).listCheckpoints(req);

    return { ok: true, response };
  } catch (err) {
    logger.warn(
      { err, route: "checkpoint/list", missionId: input.missionId },
      "ListCheckpoints failed",
    );
    return toActionError(err, "Failed to list checkpoints");
  }
}

// ---------------------------------------------------------------------------
// GetCheckpoint
// ---------------------------------------------------------------------------

export type GetCheckpointActionResult =
  | { ok: true; response: GetCheckpointResponse }
  | CheckpointActionError;

interface GetCheckpointActionInput {
  missionId: string;
  checkpointId: string;
  includeBlobs?: boolean;
}

/** Daemon `GetCheckpoint` wrapper, full decrypted payload. */
export async function getCheckpointAction(
  input: GetCheckpointActionInput,
): Promise<GetCheckpointActionResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      ok: false,
      code: Code.Unauthenticated,
      codeName: "unauthenticated",
      message: "Authentication required",
    };
  }

  try {
    await assertAuthorized(GET_METHOD);

    const req = create(GetCheckpointRequestSchema, {
      missionId: input.missionId,
      checkpointId: input.checkpointId,
      includeBlobs: input.includeBlobs ?? false,
    });

    const response = await userClient(DaemonService).getCheckpoint(req);

    return { ok: true, response };
  } catch (err) {
    logger.warn(
      {
        err,
        route: "checkpoint/get",
        missionId: input.missionId,
      },
      "GetCheckpoint failed",
    );
    return toActionError(err, "Failed to load checkpoint");
  }
}

// ---------------------------------------------------------------------------
// DiffCheckpoints
// ---------------------------------------------------------------------------

type DiffCheckpointsActionResult =
  | { ok: true; response: DiffCheckpointsResponse }
  | CheckpointActionError;

interface DiffCheckpointsActionInput {
  missionId: string;
  checkpointAId: string;
  checkpointBId: string;
}

/** Daemon `DiffCheckpoints` wrapper, server-computed delta. */
export async function diffCheckpointsAction(
  input: DiffCheckpointsActionInput,
): Promise<DiffCheckpointsActionResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      ok: false,
      code: Code.Unauthenticated,
      codeName: "unauthenticated",
      message: "Authentication required",
    };
  }

  try {
    await assertAuthorized(DIFF_METHOD);

    const req = create(DiffCheckpointsRequestSchema, {
      missionId: input.missionId,
      checkpointAId: input.checkpointAId,
      checkpointBId: input.checkpointBId,
    });

    const response = await userClient(DaemonService).diffCheckpoints(req);

    return { ok: true, response };
  } catch (err) {
    logger.warn(
      { err, route: "checkpoint/diff", missionId: input.missionId },
      "DiffCheckpoints failed",
    );
    return toActionError(err, "Failed to diff checkpoints");
  }
}

// ---------------------------------------------------------------------------
// ResumeMission (rewind)
// ---------------------------------------------------------------------------

type ResumeMissionActionResult =
  | {
      ok: true;
      /**
       * Lightweight metadata from the first ResumeMission stream event so
       * the dashboard can render the "Resumed from checkpoint X" badge
       * without consuming the full event stream server-side.
       */
      checkpointMetadata: CheckpointMetadata | null;
    }
  | CheckpointActionError;

interface ResumeMissionActionInput {
  missionId: string;
  /** When provided, the daemon rewinds to this checkpoint. */
  targetCheckpointId?: string;
}

/**
 * Daemon `ResumeMission` wrapper.
 *
 * ResumeMission returns a server-streaming response. We consume the first
 * event to confirm the resume was accepted and return any checkpoint
 * metadata for the badge. Subsequent events flow over the existing
 * mission-event stream, not this Server Action.
 */
export async function resumeMissionAction(
  input: ResumeMissionActionInput,
): Promise<ResumeMissionActionResult> {
  const session = await getServerSession();
  if (!session) {
    return {
      ok: false,
      code: Code.Unauthenticated,
      codeName: "unauthenticated",
      message: "Authentication required",
    };
  }

  try {
    await assertAuthorized(RESUME_METHOD);

    const req = create(ResumeMissionRequestSchema, {
      missionId: input.missionId,
      targetCheckpointId: input.targetCheckpointId ?? "",
    });

    const stream = userClient(DaemonService).resumeMission(req);

    let metadata: CheckpointMetadata | null = null;
    for await (const event of stream) {
      if (event.checkpointMetadata) {
        metadata = event.checkpointMetadata;
      }
      // We only consume the first event to confirm resume started.
      // The mission's regular event stream owns subsequent updates.
      break;
    }

    return { ok: true, checkpointMetadata: metadata };
  } catch (err) {
    logger.warn(
      {
        err,
        route: "mission/resume",
        missionId: input.missionId,
        hasTargetCheckpoint: Boolean(input.targetCheckpointId),
      },
      "ResumeMission failed",
    );
    return toActionError(err, "Failed to resume mission");
  }
}
