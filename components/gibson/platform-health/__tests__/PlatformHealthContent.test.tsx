// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * PlatformHealthContent (hosted#174): one unanswering secret source turns
 * its line red and shows the cause and the hint.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mockAction = vi.fn();
vi.mock("@/app/actions/platform-health", () => ({
  getPlatformHealthAction: () => mockAction(),
}));

import { PlatformHealthContent } from "../PlatformHealthContent";
import { PLATFORM_HEALTH_TEXTS as T } from "../texts";

function renderView() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PlatformHealthContent />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe("PlatformHealthContent", () => {
  it("shows a secret source that does not answer as red, with the cause", async () => {
    mockAction.mockResolvedValue({
      ok: true,
      data: [{ plane: "secret_plane", state: "unhealthy", detail: "could not get secret data", checkedAtUnix: 1700000000 }],
    });
    renderView();
    const row = await screen.findByTestId("plane-secret_plane");
    expect(row.dataset.state).toBe("unhealthy");
    expect(screen.getByText(T.state.unhealthy)).toBeInTheDocument();
    expect(screen.getByText("could not get secret data")).toBeInTheDocument();
    expect(screen.getByText(T.secretPlaneHint)).toBeInTheDocument();
  });

  it("shows an answering secret source without a hint", async () => {
    mockAction.mockResolvedValue({
      ok: true,
      data: [{ plane: "secret_plane", state: "healthy", detail: "", checkedAtUnix: 1700000000 }],
    });
    renderView();
    const row = await screen.findByTestId("plane-secret_plane");
    expect(row.dataset.state).toBe("healthy");
    expect(screen.queryByText(T.secretPlaneHint)).not.toBeInTheDocument();
  });

  it("says so when the health cannot be read", async () => {
    mockAction.mockResolvedValue({ ok: false, code: "failed" });
    renderView();
    expect(await screen.findByText(T.loadError)).toBeInTheDocument();
  });
});
