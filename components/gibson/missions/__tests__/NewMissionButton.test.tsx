// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * NewMissionButton: the one entry point into the mission editor.
 *
 *   1. An Editor (writer) or above gets a link to the editor.
 *   2. A Viewer gets a disabled button carrying the reason, never a link,
 *      so the editor's writer-only validation is never reached with the
 *      wrong role (staging, 2026-09-29).
 *   3. While the permission check runs, nothing clickable renders.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const authorize = vi.fn<() => { allowed: boolean; loading: boolean }>();
vi.mock("@/src/lib/auth/use-authorize", () => ({
  useAuthorize: (method: string) => {
    calledWith.push(method);
    return authorize();
  },
}));
const calledWith: string[] = [];

import { NewMissionButton, NEW_MISSION_DENIED_COPY, NEW_MISSION_GATE_RPC } from "../NewMissionButton";

beforeEach(() => {
  calledWith.length = 0;
  authorize.mockReset();
});

describe("NewMissionButton", () => {
  it("gates on the RPC the editor cannot run without", () => {
    authorize.mockReturnValue({ allowed: true, loading: false });
    render(<NewMissionButton />);
    expect(calledWith).toContain(NEW_MISSION_GATE_RPC);
    expect(NEW_MISSION_GATE_RPC).toBe("/gibson.daemon.v1.DaemonService/ValidateMissionCUE");
  });

  it("renders a link to the editor for an Editor or above", () => {
    authorize.mockReturnValue({ allowed: true, loading: false });
    render(<NewMissionButton href="/dashboard/missions/create?template=t1">Use this template</NewMissionButton>);
    const link = screen.getByRole("link", { name: /use this template/i });
    expect(link).toHaveAttribute("href", "/dashboard/missions/create?template=t1");
  });

  it("renders a disabled button with the reason for a Viewer, and no link", () => {
    authorize.mockReturnValue({ allowed: false, loading: false });
    render(<NewMissionButton />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/new mission/i)).toBeInTheDocument();
    const wrapper = screen.getByTestId("auth-gated-button-denied");
    expect(wrapper).toHaveAttribute("aria-disabled", "true");
    expect(NEW_MISSION_DENIED_COPY).toMatch(/Viewer/);
    expect(NEW_MISSION_DENIED_COPY).toMatch(/Editor/);
  });

  it("renders nothing clickable while the check is loading", () => {
    authorize.mockReturnValue({ allowed: false, loading: true });
    render(<NewMissionButton />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("auth-gated-button-loading")).toBeInTheDocument();
  });
});
