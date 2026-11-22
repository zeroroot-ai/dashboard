// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const { useExposure } = vi.hoisted(() => ({ useExposure: vi.fn() }));
vi.mock("@/src/hooks/useExposure", () => ({ useExposure }));

import { ExposurePanel } from "../ExposurePanel";

const period = (merged: number, reverted: number) => ({
  merged,
  reverted,
  rate: merged === 0 ? 0 : reverted / merged,
});

function mock(over: { exposure?: object; revert?: object } = {}) {
  useExposure.mockReturnValue({
    data: {
      exposure: {
        periodSeconds: 604800,
        count: 4,
        medianSeconds: 7200,
        medianAgentSeconds: 3600,
        medianWaitSeconds: 3600,
        previousCount: 3,
        previousMedianSeconds: 14400,
        ...over.exposure,
      },
      revert: { periodSeconds: 604800, current: period(10, 1), previous: period(8, 2), ...over.revert },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
}

describe("ExposurePanel", () => {
  it("shows the median with its agent time, its wait time and its trend", () => {
    mock();
    render(<ExposurePanel />);
    expect(screen.getByTestId("exposure-median").textContent).toBe("2 h");
    expect(screen.getByTestId("exposure-split").textContent).toContain("Agent time: 1 h");
    expect(screen.getByTestId("exposure-split").textContent).toContain("Wait time: 1 h");
    expect(screen.getByTestId("exposure-trend").textContent).toBe("down 2 h from 4 h in the period before.");
  });

  it("shows the revert rate with its trend", () => {
    mock();
    render(<ExposurePanel />);
    expect(screen.getByTestId("revert-value").textContent).toBe("10%");
    expect(screen.getByTestId("revert-trend").textContent).toBe("down 15 points from 25% in the period before.");
  });

  it("shows an empty state, and no zero, for a tenant with no verified finding", () => {
    mock({ exposure: { count: 0, medianSeconds: 0 }, revert: { current: period(0, 0) } });
    render(<ExposurePanel />);
    expect(screen.getByTestId("exposure-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("exposure-median")).toBeNull();
    expect(screen.getByTestId("revert-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("revert-value")).toBeNull();
  });

  it("says that the period before has no data instead of a change", () => {
    mock({ exposure: { previousCount: 0, previousMedianSeconds: 0 } });
    render(<ExposurePanel />);
    expect(screen.getByTestId("exposure-trend").textContent).toBe("The period before has no data to compare.");
  });

  it("shows an error with no number", () => {
    useExposure.mockReturnValue({ data: undefined, isLoading: false, error: new Error("boom"), refetch: vi.fn() });
    render(<ExposurePanel />);
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.queryByTestId("exposure-median")).toBeNull();
  });
});
