// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use server";

/**
 * The platform health of the Platform owner (hosted#174). It reads
 * AdminTenantService.AdminGetPlatformHealth, which carries the
 * platform_owner relation on the system tenant. ext-authz decides; a caller
 * without the relation gets `denied`, and the page and the menu entry stay
 * hidden for that caller.
 */

import { ConnectError, Code } from "@connectrpc/connect";

import {
  AdminTenantService,
  PlatformPlaneState,
} from "@/src/gen/gibson/tenant/v1/admin_tenant_pb";
import { userClient } from "@/src/lib/gibson-client";
import { authzDenial } from "@/src/lib/auth/assert-authorized";
import type { PlaneHealthView, PlaneStateView } from "@/components/gibson/platform-health/types";

export type PlatformHealthResult =
  | { ok: true; data: PlaneHealthView[] }
  | { ok: false; code: "denied" | "failed" };

function stateView(state: PlatformPlaneState): PlaneStateView {
  switch (state) {
    case PlatformPlaneState.HEALTHY:
      return "healthy";
    case PlatformPlaneState.UNHEALTHY:
      return "unhealthy";
    default:
      // UNKNOWN and an unset value are never shown as healthy.
      return "unknown";
  }
}

export async function getPlatformHealthAction(): Promise<PlatformHealthResult> {
  try {
    const resp = await userClient(AdminTenantService).adminGetPlatformHealth({});
    return {
      ok: true,
      data: resp.planes.map((p) => ({
        plane: p.plane,
        state: stateView(p.state),
        detail: p.detail,
        checkedAtUnix: Number(p.checkedAtUnix),
      })),
    };
  } catch (err) {
    if (
      authzDenial(err) ||
      (err instanceof ConnectError &&
        (err.code === Code.PermissionDenied || err.code === Code.Unauthenticated))
    ) {
      return { ok: false, code: "denied" };
    }
    return { ok: false, code: "failed" };
  }
}
