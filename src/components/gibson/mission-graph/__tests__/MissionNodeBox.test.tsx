import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";

import { MissionNodeBox, type MissionNodeBoxData } from "../MissionNodeBox";

function renderBox(data: Partial<MissionNodeBoxData>) {
  const full: MissionNodeBoxData = {
    label: "scan",
    kind: "agent",
    summary: "nmap-agent",
    isEntry: false,
    isExit: false,
    runState: "pending",
    ...data,
  };
  // MissionNodeBox only reads `data`; other NodeProps are irrelevant here.
  return render(
    <ReactFlowProvider>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <MissionNodeBox {...({ data: full } as any)} />
    </ReactFlowProvider>,
  );
}

describe("MissionNodeBox", () => {
  it("renders label, kind, and summary", () => {
    renderBox({ label: "recon", kind: "agent", summary: "nmap-agent" });
    expect(screen.getByText("recon")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("nmap-agent")).toBeInTheDocument();
  });

  it("shows entry/exit badges only when set", () => {
    const { rerender } = renderBox({ isEntry: true, isExit: false });
    expect(screen.getByText("entry")).toBeInTheDocument();
    expect(screen.queryByText("exit")).not.toBeInTheDocument();

    rerender(
      <ReactFlowProvider>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <MissionNodeBox
          {...({
            data: {
              label: "x",
              kind: "join",
              summary: "",
              isEntry: false,
              isExit: true,
              runState: "pending",
            },
          } as any)}
        />
      </ReactFlowProvider>,
    );
    expect(screen.getByText("exit")).toBeInTheDocument();
  });

  it("applies the run-state ring for a failed node", () => {
    const { container } = renderBox({ runState: "failed" });
    const box = container.querySelector(".ring-destructive");
    expect(box).not.toBeNull();
  });

  it("labels each node kind", () => {
    renderBox({ kind: "condition" });
    expect(screen.getByText("Condition")).toBeInTheDocument();
  });
});
