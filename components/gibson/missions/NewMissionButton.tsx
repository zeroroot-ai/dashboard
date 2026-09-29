// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * NewMissionButton, the one entry point into the mission editor.
 *
 * The editor cannot work without `ValidateMissionCUE`, which needs the
 * Editor role (FGA `writer`). A Viewer who reached the editor saw its
 * template validation refused and a "Failed to load missions" alert
 * (staging, 2026-09-29). So every "New Mission" call to action renders
 * through this component: hidden-on-loading, disabled with the reason for a
 * Viewer, a link for an Editor or above. The daemon still decides; this is
 * the hide-on-loading contract from CLAUDE.md § Frontend authz.
 */

import * as React from "react";
import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { AuthGatedButton } from "@/components/gibson/auth/AuthGatedButton";
import { useAuthorize } from "@/src/lib/auth/use-authorize";

/** The RPC the editor cannot run without; its relation gates the whole flow. */
export const NEW_MISSION_GATE_RPC = "/gibson.daemon.v1.DaemonService/ValidateMissionCUE";

/** Copy a Viewer reads on the disabled button. Customer terminology only. */
export const NEW_MISSION_DENIED_COPY =
  "Your role is Viewer. Ask a workspace Admin for the Editor role to create missions.";

/** The RPC every mission lifecycle action needs (start, pause, resume, stop). */
export const MISSION_RUN_GATE_RPC = "/gibson.daemon.v1.DaemonService/RunMission";

/** Copy for a mission action a Viewer cannot take. */
export const MISSION_RUN_DENIED_COPY =
  "Your role is Viewer. Ask a workspace Admin for the Editor role to run missions.";

type Props = Omit<React.ComponentProps<typeof AuthGatedButton>, "state" | "disabledTooltip" | "asChild" | "children"> & {
  /** Where the link goes. Defaults to a blank editor. */
  href?: string;
  /** Button label. Defaults to "New Mission". */
  children?: React.ReactNode;
  /** Hide the plus icon (for text-only call to actions). */
  hideIcon?: boolean;
};

export function NewMissionButton({
  href = "/dashboard/missions/create",
  children = "New Mission",
  hideIcon = false,
  ...buttonProps
}: Props) {
  const { allowed, loading } = useAuthorize(NEW_MISSION_GATE_RPC);
  const state = loading ? "loading" : allowed ? "allowed" : "denied";
  return (
    <AuthGatedButton
      state={state}
      disabledTooltip={NEW_MISSION_DENIED_COPY}
      asChild={state === "allowed"}
      {...buttonProps}
    >
      {state === "allowed" ? (
        <Link href={href}>
          {!hideIcon && <PlusCircle className="size-4" />}
          {children}
        </Link>
      ) : (
        <>
          {!hideIcon && <PlusCircle className="size-4" />}
          {children}
        </>
      )}
    </AuthGatedButton>
  );
}
