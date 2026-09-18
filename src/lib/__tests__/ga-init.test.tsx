// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { initialize, send } = vi.hoisted(() => ({ initialize: vi.fn(), send: vi.fn() }));
vi.mock("react-ga4", () => ({ default: { initialize, send } }));

import GoogleAnalyticsInit from "../../../lib/ga";

describe("GoogleAnalyticsInit", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_GA_KEY", "G-TEST");
    initialize.mockClear();
    send.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("initialises once and sends one pageview across re-renders", () => {
    const view = render(<GoogleAnalyticsInit />);
    view.rerender(<GoogleAnalyticsInit />);
    view.rerender(<GoogleAnalyticsInit />);
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a key", () => {
    vi.stubEnv("NEXT_PUBLIC_GA_KEY", "");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<GoogleAnalyticsInit />);
    expect(initialize).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
