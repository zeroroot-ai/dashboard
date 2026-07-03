"use server";

/**
 * Server actions for the MissionCUEEditor's three language-service RPCs:
 * ValidateMissionCUE, CompleteMissionCUE, HoverMissionCUE.
 *
 * Each action dials the daemon through the Envoy + SPIFFE-mTLS path via
 * userClient — whose transport bakes a per-RPC assertAuthorized check into
 * every dispatch (dashboard#848 / #902) — and returns a plain-object result
 * that the editor's Monaco providers can consume directly. A denial throws
 * AuthzDeniedError from inside the RPC call; each action maps it to its
 * graceful empty result (dashboard#904).
 *
 * Spec: dashboard#291 (CUE editor / platform-sdk v0.7.0). Migrated to
 * DaemonService (OSS SDK) per ADR-0037 in dashboard#336.
 */

import "server-only";

import { AuthzDeniedError } from "@/src/lib/auth/assert-authorized";
import { userClient } from "@/src/lib/gibson-client";
import { DaemonService } from "@/src/gen/gibson/daemon/v1/daemon_pb";

// ---------------------------------------------------------------------------
// Return types (plain objects safe to serialise across the server/client
// boundary without proto message classes)
// ---------------------------------------------------------------------------

interface CUEDiagnosticResult {
  line: number;
  col: number;
  message: string;
  severity: string;
}

interface CUECompletionItemResult {
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
    const client = userClient(DaemonService);
    const resp = await client.validateMissionCUE({ cueSource });
    return resp.diagnostics.map((d) => ({
      line: d.line,
      col: d.col,
      message: d.message,
      severity: d.severity,
    }));
  } catch (err) {
    if (err instanceof AuthzDeniedError) return [];
    throw err;
  }
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
    const client = userClient(DaemonService);
    const resp = await client.completeMissionCUE({ cueSource, line, col });
    return resp.items.map((item) => ({
      label: item.label,
      detail: item.detail,
      documentation: item.documentation,
      kind: item.kind,
    }));
  } catch (err) {
    if (err instanceof AuthzDeniedError) return [];
    throw err;
  }
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
    const client = userClient(DaemonService);
    const resp = await client.hoverMissionCUE({ cueSource, line, col });
    return resp.markdown;
  } catch (err) {
    if (err instanceof AuthzDeniedError) return "";
    throw err;
  }
}
