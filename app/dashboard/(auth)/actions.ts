"use server";

import { logger } from "@/src/lib/logger";

/**
 * Server action that logs an auth error boundary trigger server-side.
 *
 * The error boundary component is "use client" and cannot import pino
 * directly (pino is not safe to bundle into client code). This action
 * receives only the opaque `digest` string, the Error object itself is
 * never forwarded from the client, and emits a structured log entry
 * through the dashboard's canonical logger.
 *
 * The caller should invoke this fire-and-forget (no await, no catch) so a
 * logging failure cannot block the error boundary reset path.
 */
export async function logAuthBoundaryError({
  digest,
}: {
  digest?: string;
}): Promise<void> {
  logger.error(
    { event: "dashboard.auth.error_boundary", digest },
    "auth error boundary triggered"
  );
}
