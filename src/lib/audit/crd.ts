import "server-only";

import { recordDebugError } from "@/src/lib/debug";
import { truncate } from "./shared";

import type { CrdActionName } from "@/app/actions/crd/types";
import type { GibsonSession } from "@/src/lib/auth";

/**
 * Audit event emitted by every CRD Server Action, on both success and
 * denial paths. Event shape is intentionally aligned with the daemon's
 * audit proto so a future durable sink can be added without a schema
 * migration.
 *
 * IMPORTANT: Never include secret material in any field. `inputKeys` is
 * the list of input field names (values withheld), use it to record that
 * `bootstrapTokenRef` was part of the input without logging the token.
 */
export type CrdAuditOutcome =
  | "ok"
  | "unauthenticated"
  | "forbidden"
  | "bad_input"
  | "rate_limited"
  | "internal";

export interface CrdAuditEvent {
  ts: string;
  action: CrdActionName;
  outcome: CrdAuditOutcome;
  userId: string; // "anonymous" when no session
  sessionTenantId: string | null;
  targetTenant: string | null;
  crossTenant: boolean;
  inputKeys: string[];
  resourceRef?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Emit a CRD audit event as a single JSON line on stdout. The existing
 * Loki pipeline parses JSON logs with the `[audit.crd]` prefix.
 * Synchronous and fire-and-forget. Any failure is swallowed and routed to
 * the in-memory debug ring buffer so it never masks the caller's result.
 */
export function emitCrdAudit(event: CrdAuditEvent): void {
  try {
    const payload = {
      ...event,
      errorMessage: truncate(event.errorMessage),
    };
    // Single JSON line keeps Loki indexing cheap and predictable.
    console.info(`[audit.crd] ${JSON.stringify(payload)}`);
  } catch (err) {
    try {
      recordDebugError({
        ts: new Date().toISOString(),
        route: "audit.crd.emit",
        method: "ACTION",
        status: 500,
        message: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // last-resort swallow, never throw from audit
    }
  }
}

/**
 * Convenience helper, emit an audit event using a successful gate's
 * session context. Callers after a successful `requireCrdSession` call use
 * this to avoid re-specifying userId / crossTenant on every emission.
 *
 * `sessionTenantId` is recorded as the gate-resolved targetTenant (the
 * active tenant confirmed by requireActiveTenant() inside requireCrdSession).
 * The session object is no longer an authority for the active tenant
 * (dashboard#583 lock-in), the resolved tenant always comes from the
 * request-scoped cookie validation.
 */
export function emitCrdAuditFromGate(args: {
  session: GibsonSession;
  userId: string;
  action: CrdActionName;
  outcome: CrdAuditOutcome;
  targetTenant: string | null;
  inputKeys: string[];
  resourceRef?: string;
  errorCode?: string;
  errorMessage?: string;
}): void {
  emitCrdAudit({
    ts: new Date().toISOString(),
    action: args.action,
    outcome: args.outcome,
    userId: args.userId,
    // Record the gate-resolved tenant, not a session field.
    // session.user.tenantId was removed in dashboard#583 lock-in.
    sessionTenantId: args.targetTenant,
    targetTenant: args.targetTenant,
    crossTenant: args.session.user.crossTenant,
    inputKeys: args.inputKeys,
    resourceRef: args.resourceRef,
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
  });
}
