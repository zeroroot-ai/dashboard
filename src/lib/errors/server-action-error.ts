import "server-only";

/**
 * Canonical daemon-error mapping for **Server Actions**.
 *
 * WHY THIS EXISTS
 * ---------------
 * `app/api/<path>/route.ts` handlers already funnel every daemon failure
 * through `daemonErrorResponse` in `src/lib/api-errors.ts`: one class, one
 * stable message, one correlation ID, and the daemon's own words stay in the
 * server log. Server Actions never got the same treatment. The prevailing
 * shape there is
 *
 *     const msg = err instanceof Error ? err.message : "Failed to ...";
 *     return { ok: false, error: msg, code: (err as { code?: string }).code };
 *
 * which returns the daemon's raw text straight to the browser. That text is
 * written for operators, not customers: it can name internal hostnames, mounts,
 * table and column names, gRPC method paths, upstream provider responses and
 * whatever a wrapped Go error accumulated on its way up. None of that belongs
 * in a browser, and collectively it is a free map of the platform's internals.
 *
 * This module is the Server Action counterpart. It returns an opaque, stable
 * class plus canonical copy, and keeps the detail server-side against a
 * correlation ID the user can quote to support.
 *
 * RELATIONSHIP TO api-errors.ts
 * -----------------------------
 * Deliberately not a copy. The class table, the ConnectError classification
 * and the correlation-ID format are imported from `api-errors`, so the two
 * surfaces cannot drift. The only differences are the return shape (a plain
 * object, not a `NextResponse`) and one policy choice below.
 *
 * POLICY: the daemon's message is never forwarded, for any class.
 * `daemonErrorResponse` forwards it for `InvalidArgument` so a form can name
 * the offending field. Server Actions in this codebase validate their input
 * with Zod before dispatch, so a daemon-side `InvalidArgument` here means the
 * dashboard and the daemon disagree about the contract, which is an
 * engineering signal, not a user-actionable one. Forwarding it would reopen
 * the same leak for the one class an attacker can most easily provoke.
 *
 * @module lib/errors/server-action-error
 */

import { ConnectError, Code } from "@connectrpc/connect";

import {
  ERROR_CLASS_TABLE,
  classifyConnectCode,
  generateCorrelationId,
  type ErrorClass,
} from "@/src/lib/api-errors";
import { logger } from "@/src/lib/logger";

/**
 * Textual gRPC code names to the Connect enum.
 *
 * Needed because the gibson-client wrappers do not rethrow `ConnectError`.
 * `throwMapped` in `src/lib/gibson-client/secrets.ts` flattens it into a plain
 * `Error` carrying a string `code`, so by the time an action's catch block runs
 * the type information is gone. In production that string is the numeric enum
 * value (`Code` is a numeric enum, so `err.code.toString()` yields "14", which
 * is also why the `code` these actions returned to the browser was an opaque
 * number). Both spellings are recognised here.
 */
const CODE_NAMES: Record<string, Code> = {
  canceled: Code.Canceled,
  unknown: Code.Unknown,
  invalidargument: Code.InvalidArgument,
  invalid_argument: Code.InvalidArgument,
  deadlineexceeded: Code.DeadlineExceeded,
  deadline_exceeded: Code.DeadlineExceeded,
  notfound: Code.NotFound,
  not_found: Code.NotFound,
  alreadyexists: Code.AlreadyExists,
  already_exists: Code.AlreadyExists,
  permissiondenied: Code.PermissionDenied,
  permission_denied: Code.PermissionDenied,
  resourceexhausted: Code.ResourceExhausted,
  resource_exhausted: Code.ResourceExhausted,
  failedprecondition: Code.FailedPrecondition,
  failed_precondition: Code.FailedPrecondition,
  aborted: Code.Aborted,
  outofrange: Code.OutOfRange,
  out_of_range: Code.OutOfRange,
  unimplemented: Code.Unimplemented,
  internal: Code.Internal,
  unavailable: Code.Unavailable,
  dataloss: Code.DataLoss,
  data_loss: Code.DataLoss,
  unauthenticated: Code.Unauthenticated,
};

/**
 * Recover a class from the flattened `Error & { code: string }` shape the
 * gibson-client wrappers throw. Returns null when the string means nothing,
 * leaving the caller to fall back to `internal`.
 */
function classifyWrappedCode(raw: string): ErrorClass | null {
  const numeric = Number(raw);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 16) {
    return classifyConnectCode(numeric as Code);
  }
  const named = CODE_NAMES[raw.toLowerCase()];
  return named === undefined ? null : classifyConnectCode(named);
}

/**
 * The shape a Server Action returns on failure.
 *
 * Structurally compatible with the `{ ok: false; error: string; code?: string }`
 * result types the existing actions already declare, so adopting this helper is
 * a one-line change at each call site.
 */
export interface ServerActionErrorResult {
  ok: false;
  /** Canonical, user-renderable copy. Never the daemon's own words. */
  error: string;
  /** Stable machine-readable class. One of {@link ErrorClass}. */
  code: ErrorClass;
  /** Per-request ID; the matching server log line carries the detail. */
  correlationId: string;
}

interface ServerActionErrorOptions {
  /**
   * Logical action name, recorded on the log line so a correlation ID quoted
   * by a user leads straight back to the originating action.
   */
  action?: string;
  /**
   * Optional last-pass scrubber applied to the detail **before it is logged**.
   * Actions that handle credential material pass their own redactor here, so
   * a daemon message that echoed part of a submitted secret cannot reach the
   * log either. The returned value is never sent to the client regardless.
   */
  redact?: (detail: string) => string;
}

/**
 * Map any error caught at a Server Action boundary onto an opaque result.
 *
 * Call this only after the action's own `permissionDeniedResult(err)` check:
 * the authz wrapper throws `AuthzDeniedError`, which is not a `ConnectError`
 * and would otherwise classify as `internal`.
 *
 * @example
 * ```ts
 * } catch (err) {
 *   const denied = permissionDeniedResult(err);
 *   if (denied) return denied;
 *   return serverActionError(err, { action: "setSecretAction" });
 * }
 * ```
 */
export function serverActionError(
  err: unknown,
  options: ServerActionErrorOptions = {},
): ServerActionErrorResult {
  const correlationId = generateCorrelationId();

  let cls: ErrorClass;
  let detail: string;

  if (err instanceof ConnectError) {
    cls = classifyConnectCode(err.code);
    detail = err.rawMessage;
    // Same provisioning sub-classification the API surface applies, so both
    // surfaces render the same "workspace still being set up" affordance.
    if (
      cls === "failed_precondition" &&
      /tenant data.?plane not provisioned/i.test(detail)
    ) {
      cls = "provisioning";
    }
  } else if (err instanceof Error) {
    const wrapped = (err as Error & { code?: unknown }).code;
    cls =
      (typeof wrapped === "string" || typeof wrapped === "number"
        ? classifyWrappedCode(String(wrapped))
        : null) ?? "internal";
    detail = err.message;
    if (
      cls === "failed_precondition" &&
      /tenant data.?plane not provisioned/i.test(detail)
    ) {
      cls = "provisioning";
    }
  } else {
    cls = "internal";
    detail = String(err);
  }

  logger.error(
    {
      errorClass: cls,
      correlationId,
      action: options.action,
      detail: options.redact ? options.redact(detail) : detail,
    },
    "server action returned canonical error",
  );

  return {
    ok: false,
    error: ERROR_CLASS_TABLE[cls].message,
    code: cls,
    correlationId,
  };
}
