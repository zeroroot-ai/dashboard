// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PlayIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { type buttonVariants } from "@/components/ui/button";
import { type VariantProps } from "class-variance-authority";
import { apiFetch } from "@/src/lib/api/fetch";
import { AuthGatedButton } from "@/components/gibson/auth/AuthGatedButton";
import { useAuthorize } from "@/src/lib/auth/use-authorize";
import { MISSION_RUN_DENIED_COPY, MISSION_RUN_GATE_RPC } from "@/components/gibson/missions/NewMissionButton";

type ButtonProps = React.ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

interface RunDemoMissionButtonProps extends Omit<ButtonProps, "onClick" | "type"> {
  /** Override the default child rendering. */
  children?: React.ReactNode;
}

/**
 * RunDemoMissionButton, fires the one-click demo flow.
 *
 * Calls POST /api/missions/demo (CSRF-protected, mirrors /api/missions/[id]/start
 * shape). On success, navigates to the mission detail page so the user can
 * watch ToolStreamProgress + see Findings/Traces populate as the scan runs.
 *
 * On error, surfaces a toast with the daemon's affordance message, no
 * navigation. The button is disabled while in flight to prevent
 * double-dispatch.
 */
export function RunDemoMissionButton({
  children,
  disabled,
  ...rest
}: RunDemoMissionButtonProps) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  // The demo launches a mission, which needs the Editor role. Hidden while
  // the check runs, disabled with the reason for a Viewer.
  const { allowed, loading } = useAuthorize(MISSION_RUN_GATE_RPC);
  const state = loading ? "loading" : allowed ? "allowed" : "denied";

  async function handleClick() {
    setPending(true);
    try {
      const response = await apiFetch("/api/missions/demo", {
        method: "POST",
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message =
          body?.error?.affordance ||
          body?.error?.message ||
          `Failed to start demo mission (${response.status})`;
        toast.error(message);
        return;
      }

      const missionId = body?.missionId;
      if (!missionId) {
        toast.error("Demo mission started but no mission id returned");
        return;
      }

      toast.success(`Demo mission started against ${body.target ?? "scanme.nmap.org"}`);
      router.push(`/dashboard/results/${missionId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to start demo mission: ${message}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthGatedButton
      {...rest}
      state={state}
      disabledTooltip={MISSION_RUN_DENIED_COPY}
      disabled={disabled || pending}
      onClick={handleClick}
    >
      {pending ? (
        <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
      ) : (
        <PlayIcon className="size-4" aria-hidden="true" />
      )}
      {children ?? (pending ? "Starting demo…" : "Run demo mission")}
    </AuthGatedButton>
  );
}
