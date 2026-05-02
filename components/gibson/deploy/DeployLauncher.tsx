"use client";

/**
 * DeployLauncher
 *
 * Small admin-gated CTA that links to the unified deploy wizard
 * (`/dashboard/deploy?type=<type>`). Renders nothing for non-admin users
 * so the wizard launcher does not flash on member views — the wizard
 * itself enforces server-side authz on submit, this is purely UX hygiene.
 *
 * Used by `/dashboard/agents`, `/dashboard/plugins`, and `/dashboard/tools`
 * to surface the new enrollment wizard from each component-type landing page.
 */

import Link from "next/link";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { usePermitted } from "@/src/lib/auth/tenant";

const LABELS: Record<"agent" | "plugin" | "tool", string> = {
  agent: "Deploy agent",
  plugin: "Deploy plugin",
  tool: "Deploy tool",
};

export function DeployLauncher({
  type,
}: {
  type: "agent" | "plugin" | "tool";
}) {
  const canManage = usePermitted("components:manage");
  if (!canManage) return null;

  return (
    <div className="flex items-center justify-end">
      <Button asChild size="sm" className="gap-1.5">
        <Link href={`/dashboard/deploy?type=${type}`}>
          <PlusIcon className="size-3.5" aria-hidden="true" />
          {LABELS[type]}
        </Link>
      </Button>
    </div>
  );
}
