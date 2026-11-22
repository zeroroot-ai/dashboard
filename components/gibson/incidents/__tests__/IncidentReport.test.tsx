// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { useIncidentReport } = vi.hoisted(() => ({ useIncidentReport: vi.fn() }));
vi.mock("@/src/hooks/useIncidentReport", () => ({ useIncidentReport }));
vi.mock("@/src/lib/session-client", () => ({ useSession: () => ({ data: { user: { id: "me" } } }) }));
vi.mock("@/src/hooks/useUserRefs", () => ({
  useUserRefs: () => ({
    data: new Map([["u1", { userId: "u1", state: "member", displayName: "Ada", email: "" }]]),
  }),
}));

import { IncidentReport } from "../IncidentReport";

const known = (n: number) => ({ known: true, timelineSeq: n, replaySeq: n + 1 });
const unknown = { known: false, timelineSeq: 0, replaySeq: 0 };

function mock(over: Record<string, unknown> = {}) {
  useIncidentReport.mockReturnValue({
    data: {
      incidentKey: "inc-1",
      timelineTotal: 20,
      alerts: [{ key: "a1", title: "Odd login", source: "siem", severity: "high", frame: known(4) }],
      reached: [{ label: "Host", key: "h1", alertKey: "a1", frame: unknown }],
      actions: [
        {
          toolId: "mcp:edr:isolate",
          connector: "edr",
          tool: "isolate",
          agentName: "responder",
          outcome: "done",
          error: "",
          result: "<b>isolated</b>",
          controlIds: ["ac-12"],
          grant: { id: "g1", capability: "isolate", grantedBy: "u1", grantedAtUnix: 1 },
          frame: known(7),
        },
        {
          toolId: "mcp:edr:kill",
          connector: "edr",
          tool: "kill",
          agentName: "responder",
          outcome: "refused",
          error: "no grant",
          result: "",
          controlIds: [],
          grant: null,
          frame: known(9),
        },
      ],
      causes: [
        {
          findingKey: "f1",
          title: "Weak password",
          severity: "high",
          status: "verified",
          raised: known(1),
          history: [{ status: "fixing", frame: known(3) }],
        },
      ],
      fixes: [
        {
          findingKey: "f1",
          mergeRequestKey: "mr",
          url: "https://git.example/mr/1",
          ref: "!1",
          frame: known(5),
          verifiedBy: "pipe-1",
          verified: known(11),
        },
      ],
      controlIds: ["ac-12"],
      ...over,
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe("IncidentReport", () => {
  it("links each line that has a Timeline event to its replay frame", () => {
    mock();
    render(<IncidentReport incidentKey="inc-1" />);
    const hrefs = screen.getAllByTestId("incident-replay").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/dashboard/world?seq=4");
    expect(hrefs).toContain("/dashboard/world?seq=7");
    expect(hrefs).toContain("/dashboard/world?seq=11");
  });

  it("shows no link for a line with no Timeline event", () => {
    mock();
    render(<IncidentReport incidentKey="inc-1" />);
    expect(screen.getAllByTestId("incident-no-frame")).toHaveLength(1);
  });

  it("shows each action with its outcome, its grant and the person who gave it, and no grant for a refused one", () => {
    mock();
    render(<IncidentReport incidentKey="inc-1" />);
    expect(screen.getAllByTestId("incident-action-outcome").map((e) => e.textContent)).toEqual(["Done", "Refused"]);
    expect(screen.getAllByTestId("incident-action-grant").map((e) => e.textContent)).toEqual([
      "Grant: isolate. Granted by: Ada.",
      "no grant recorded",
    ]);
    expect(screen.getByTestId("incident-action-controls").textContent).toBe("ac-12");
  });

  it("shows text of a tool as plain text", () => {
    mock();
    render(<IncidentReport incidentKey="inc-1" />);
    expect(screen.getByText("<b>isolated</b>")).toBeInTheDocument();
  });

  it("shows the proof of the fix, and says when it is not verified", () => {
    mock();
    const { unmount } = render(<IncidentReport incidentKey="inc-1" />);
    expect(screen.getByTestId("incident-fix-proof").textContent).toBe("Verified. Verified by: pipe-1");
    unmount();
    mock({ fixes: [{ findingKey: "f1", mergeRequestKey: "mr", url: "", ref: "", frame: known(5), verifiedBy: "", verified: unknown }] });
    render(<IncidentReport incidentKey="inc-1" />);
    expect(screen.getByTestId("incident-fix-proof").textContent).toBe("Not verified");
  });

  it("says none for an empty section and shows an error with no report", () => {
    mock({ alerts: [], reached: [] });
    const { unmount } = render(<IncidentReport incidentKey="inc-1" />);
    expect(screen.getAllByText("None.").length).toBeGreaterThanOrEqual(2);
    unmount();
    useIncidentReport.mockReturnValue({ data: undefined, isLoading: false, error: new Error("boom"), refetch: vi.fn() });
    render(<IncidentReport incidentKey="inc-1" />);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
