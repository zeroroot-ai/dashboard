"use client";

/**
 * DeployLauncher
 *
 * Primary CTA on the agents, tools, and plugins list pages that opens
 * the unified deploy wizard at `/dashboard/deploy?type=<type>`.
 *
 * Visibility contract — see components/gibson/auth/AuthGatedButton.tsx
 * for the three-state design rationale:
 *
 *   allowed (admin)  → clickable Link button
 *   denied (member)  → disabled Button with tooltip explaining the
 *                       permission they need. The button stays visible
 *                       so non-admin users can see the affordance and
 *                       know who to ask for access.
 *
 * The wizard itself enforces server-side authz on submit; this gate is
 * purely UX. Authorization is resolved via `useAuthorize` against the
 * tenant component-management RPC (SetComponentAccess, relation: admin);
 * while the membership query is in flight the AuthGatedButton renders its
 * loading skeleton.
 */

import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { AuthGatedButton } from "@/components/gibson/auth";
import { useAuthorize } from "@/src/lib/auth/use-authorize";

// Component deploy/management is gated on the tenant component-management
// RPC (relation: admin); the deploy wizard enforces the real per-type authz
// on submit.
const COMPONENT_MANAGE_RPC =
  "/gibson.admin.v1.TenantAdminService/SetComponentAccess";

const LABELS: Record<"agent" | "plugin" | "tool", string> = {
  agent: "Deploy agent",
  plugin: "Deploy plugin",
  tool: "Deploy tool",
};

const DENIED_TOOLTIP =
  "You need component-management permission to deploy. Ask your tenant admin to grant it.";

export function DeployLauncher({
  type,
}: {
  type: "agent" | "plugin" | "tool";
}) {
  const { allowed: canManage, loading } = useAuthorize(COMPONENT_MANAGE_RPC);
  const state = loading ? "loading" : canManage ? "allowed" : "denied";

  return (
    <div className="flex items-center justify-end">
      <AuthGatedButton
        state={state}
        disabledTooltip={DENIED_TOOLTIP}
        size="sm"
        className="gap-1.5"
        asChild={canManage}
      >
        {canManage ? (
          <Link href={`/dashboard/deploy?type=${type}`}>
            <PlusIcon className="size-3.5" aria-hidden="true" />
            {LABELS[type]}
          </Link>
        ) : (
          <>
            <PlusIcon className="size-3.5" aria-hidden="true" />
            {LABELS[type]}
          </>
        )}
      </AuthGatedButton>
    </div>
  );
}
