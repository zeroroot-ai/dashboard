// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { useActionsByGrant } = vi.hoisted(() => ({ useActionsByGrant: vi.fn() }));
vi.mock("@/src/hooks/useActionsByGrant", () => ({ useActionsByGrant }));
vi.mock("@/src/lib/session-client", () => ({ useSession: () => ({ data: { user: { id: "me" } } }) }));
vi.mock("@/src/hooks/useUserRefs", () => ({
  useUserRefs: () => ({
    data: new Map([["u2", { userId: "u2", state: "member", displayName: "Ada", email: "" }]]),
  }),
}));

import { ActionsPanel } from "../ActionsPanel";

function group(over: Record<string, unknown> = {}) {
  return {
    grantObject: "connector:git",
    grantRelation: "can_use",
    grantor: "u2",
    refused: false,
    count: 3,
    first: "2026-11-20T10:00:00.000Z",
    last: "2026-11-20T11:00:00.000Z",
    agents: ["fixer"],
    tools: ["open_mr"],
    ...over,
  };
}

function mock(groups: unknown[], truncated = false) {
  useActionsByGrant.mockReturnValue({
    data: { groups, truncated },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe("ActionsPanel", () => {
  it("groups the actions by grant and by grantor", () => {
    mock([group(), group({ grantObject: "connector:chat", grantor: "me", count: 1 })]);
    render(<ActionsPanel />);
    expect(screen.getAllByTestId("action-group-grant").map((e) => e.textContent)).toEqual([
      "connector:git#can_use",
      "connector:chat#can_use",
    ]);
    expect(screen.getAllByTestId("action-group-grantor").map((e) => e.textContent)).toEqual([
      "Granted by: Ada",
      "Granted by: me",
    ]);
    expect(screen.getAllByTestId("action-group-count").map((e) => e.textContent)).toEqual(["3 actions", "1 action"]);
  });

  it("shows the grant that a refused action lacked, with no grantor", () => {
    mock([group({ refused: true, grantor: "" })]);
    render(<ActionsPanel />);
    expect(screen.getByTestId("action-group").getAttribute("data-refused")).toBe("true");
    expect(screen.getByTestId("action-group-grantor").textContent).toBe("Refused. The agent lacked this grant.");
  });

  it("says that no grantor is recorded when the audit record holds none", () => {
    mock([group({ grantor: "" })]);
    render(<ActionsPanel />);
    expect(screen.getByTestId("action-group-grantor").textContent).toBe("Granted by: no grantor recorded");
  });

  it("links each row to the audit log", () => {
    mock([group()]);
    render(<ActionsPanel />);
    expect(screen.getByTestId("action-group-audit").getAttribute("href")).toBe("/dashboard/organization/audit-log");
  });

  it("shows an empty text, a truncation note and an error", () => {
    mock([]);
    const { unmount } = render(<ActionsPanel />);
    expect(screen.getByTestId("actions-empty")).toBeInTheDocument();
    unmount();
    mock([group()], true);
    const second = render(<ActionsPanel />);
    expect(screen.getByTestId("actions-truncated")).toBeInTheDocument();
    second.unmount();
    useActionsByGrant.mockReturnValue({ data: undefined, isLoading: false, error: new Error("boom"), refetch: vi.fn() });
    render(<ActionsPanel />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
