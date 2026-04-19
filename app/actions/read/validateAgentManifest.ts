"use server";

/**
 * validateAgentManifestAction — browser-callable wrapper around
 * DiscoveryService.ValidateComponent. The install dialog renders the
 * response's schema/access error lists before displaying the permission
 * checklist.
 *
 * Spec: access-matrix-finish task 15, R5 AC 1.
 */

import { createGrpcTransport } from "@connectrpc/connect-node";
import { createClient } from "@connectrpc/connect";

import { DiscoveryService } from "@/src/gen/gibson/daemon/discovery/v1/discovery_pb";
import { getServerSession } from "@/src/lib/auth";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export interface ValidationError {
  path: string;
  message: string;
}

export interface AccessError {
  target: string;
  action: "read" | "write" | "execute";
  required: boolean;
  reason: string;
}

export interface ManifestValidationResult {
  ok: boolean;
  schemaErrors: ValidationError[];
  accessErrors: AccessError[];
  slotErrors: string[];
  protoViolations: string[];
}

const DAEMON_ADDR =
  process.env.GIBSON_DAEMON_ADDRESS || "gibson:50002";

function discoveryClient() {
  const transport = createGrpcTransport({
    baseUrl: `http://${DAEMON_ADDR}`,
  });
  return createClient(DiscoveryService, transport);
}

function actionFromNumeric(n: number): "read" | "write" | "execute" {
  switch (n) {
    case 1:
      return "read";
    case 2:
      return "write";
    case 3:
      return "execute";
    default:
      return "read";
  }
}

export async function validateAgentManifestAction(input: {
  componentYaml: string;
  permissionsYaml: string;
}): Promise<ActionResult<ManifestValidationResult>> {
  const session = await getServerSession();
  if (!session?.user) {
    return { ok: false, error: "unauthenticated" };
  }
  try {
    const resp = await discoveryClient().validateComponent({
      componentYaml: new TextEncoder().encode(input.componentYaml),
      permissionsYaml: new TextEncoder().encode(input.permissionsYaml),
    });
    return {
      ok: true,
      data: {
        ok: resp.ok,
        schemaErrors: resp.schemaErrors.map((e) => ({
          path: (e as { path?: string }).path ?? "",
          message: (e as { message?: string }).message ?? "",
        })),
        accessErrors: resp.accessErrors.map((e) => {
          const raw = e as {
            target?: string;
            action?: number;
            required?: boolean;
            reason?: string;
          };
          return {
            target: raw.target ?? "",
            action: actionFromNumeric(raw.action ?? 0),
            required: raw.required ?? false,
            reason: raw.reason ?? "",
          };
        }),
        slotErrors: resp.slotErrors ?? [],
        protoViolations: resp.protoViolations ?? [],
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
