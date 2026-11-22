// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * ConnectorsContent groups the enabled connectors by tool class (dashboard#381).
 * The Server Actions, useAuthorize and the router are mocked.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/src/lib/auth/use-authorize", () => ({ useAuthorize: () => ({ allowed: false, loading: false }) }));
vi.mock("@/src/hooks/useAccessibleComponents", () => ({
  useAccessibleComponents: () => ({ items: [], setItems: vi.fn(), loading: false, error: null, refetch: vi.fn() }),
}));
vi.mock("@/app/actions/crd/access", () => ({ setComponentAccessAction: vi.fn() }));

const catalogEntry = (id: string, toolClass: string) => ({
  id,
  displayName: `Name ${id}`,
  description: "",
  shape: "Hosted",
  auth: "none",
  defaultInstanceUrl: "",
  toolClass,
});
const connector = (id: string) => ({
  id,
  shape: "Hosted",
  runtime: "hosted",
  phase: "Ready",
  discoveredTools: 0,
  lastError: "",
});

const { list } = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/app/actions/connectors", () => ({
  listConnectorsAction: list,
  getConnectorAuthStatusAction: vi.fn(),
  enableConnectorAction: vi.fn(),
  disableConnectorAction: vi.fn(),
  authorizeConnectorAction: vi.fn(),
  pollConnectorAuthAction: vi.fn(),
  CONNECTOR_ENABLE_RPC: "enable",
  CONNECTOR_DISABLE_RPC: "disable",
}));

import { ConnectorsContent } from "../ConnectorsContent";

describe("ConnectorsContent tool class groups", () => {
  it("shows each enabled connector under its tool class and an unclassed one under unknown", async () => {
    list.mockResolvedValue({
      ok: true,
      data: {
        catalog: [catalogEntry("splunk", "siem"), catalogEntry("crowdstrike", "edr"), catalogEntry("odd", "")],
        enabled: [connector("splunk"), connector("odd"), connector("crowdstrike")],
      },
    });
    render(<ConnectorsContent docsHref="/docs" />);
    const headings = await screen.findAllByTestId("tool-class-heading");
    expect(headings.map((h) => h.textContent)).toEqual(["edr", "siem", "Unknown"]);
    const groups = screen.getAllByTestId("tool-class-group");
    expect(groups[1].textContent).toContain("Name splunk");
    expect(groups[2].textContent).toContain("Name odd");
  });
});
