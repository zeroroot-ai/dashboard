"use server";

/**
 * Server actions for the MissionCUEEditor's three language-service RPCs:
 * ValidateMissionCUE, CompleteMissionCUE, HoverMissionCUE.
 *
 * Each action: (1) calls assertAuthorized against the FGA registry entry for
 * the corresponding DaemonAdminService RPC; (2) dials the daemon through the
 * Envoy + SPIFFE-mTLS path via userClient; (3) returns a plain-object result
 * that the editor's Monaco providers can consume directly.
 *
 * Spec: dashboard#291 (CUE editor / platform-sdk v0.7.0).
 */

import "server-only";

import {
  assertAuthorized,
  AuthzDeniedError,
} from "@/src/lib/auth/assert-authorized";
import { userClient } from "@/src/lib/gibson-client";
import { DaemonAdminService } from "@/src/gen/gibson/daemon/admin/v1/daemon_admin_pb";

// ---------------------------------------------------------------------------
// FGA registry keys (mirror the daemon's authz annotations)
// ---------------------------------------------------------------------------

const FGA_VALIDATE =
  "/gibson.daemon.admin.v1.DaemonAdminService/ValidateMissionCUE";
const FGA_COMPLETE =
  "/gibson.daemon.admin.v1.DaemonAdminService/CompleteMissionCUE";
const FGA_HOVER =
  "/gibson.daemon.admin.v1.DaemonAdminService/HoverMissionCUE";

// ---------------------------------------------------------------------------
// Return types (plain objects safe to serialise across the server/client
// boundary without proto message classes)
// ---------------------------------------------------------------------------

export interface CUEDiagnosticResult {
  line: number;
  col: number;
  message: string;
  severity: string;
}

export interface CUECompletionItemResult {
  label: string;
  detail: string;
  documentation: string;
  /** kind classifies the item: "field" | "value" | "keyword" */
  kind: string;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Validate CUE source against the mission schema.
 *
 * Returns a (possibly empty) list of diagnostics. An empty list means the
 * source compiled cleanly.
 */
export async function validateMissionCUEAction(
  cueSource: string
): Promise<CUEDiagnosticResult[]> {
  try {
    await assertAuthorized(FGA_VALIDATE);
  } catch (err) {
    if (err instanceof AuthzDeniedError) return [];
    throw err;
  }

  const client = userClient(DaemonAdminService);
  const resp = await client.validateMissionCUE({ cueSource });
  return resp.diagnostics.map((d) => ({
    line: d.line,
    col: d.col,
    message: d.message,
    severity: d.severity,
  }));
}

/**
 * Request completion items at a cursor position.
 *
 * `line` and `col` are 1-based, matching the convention used by CUE's LSP
 * and Monaco's `getPosition()` output (Monaco provides 1-based numbers).
 */
export async function completeMissionCUEAction(
  cueSource: string,
  line: number,
  col: number
): Promise<CUECompletionItemResult[]> {
  try {
    await assertAuthorized(FGA_COMPLETE);
  } catch (err) {
    if (err instanceof AuthzDeniedError) return [];
    throw err;
  }

  const client = userClient(DaemonAdminService);
  const resp = await client.completeMissionCUE({ cueSource, line, col });
  return resp.items.map((item) => ({
    label: item.label,
    detail: item.detail,
    documentation: item.documentation,
    kind: item.kind,
  }));
}

/**
 * Request hover documentation (Markdown) at a cursor position.
 *
 * Returns an empty string when no documentation is available at the position.
 */
export async function hoverMissionCUEAction(
  cueSource: string,
  line: number,
  col: number
): Promise<string> {
  try {
    await assertAuthorized(FGA_HOVER);
  } catch (err) {
    if (err instanceof AuthzDeniedError) return "";
    throw err;
  }

  const client = userClient(DaemonAdminService);
  const resp = await client.hoverMissionCUE({ cueSource, line, col });
  return resp.markdown;
}
