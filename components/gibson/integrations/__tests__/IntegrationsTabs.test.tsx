// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The one Integrations page (dashboard#86): plugins and connectors are two
 * tabs, the active tab comes from the URL, and a tab change writes it back.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/dashboard/integrations",
}));

import { IntegrationsTabs } from "../IntegrationsTabs";

beforeEach(() => vi.clearAllMocks());

function renderTabs(active: "plugins" | "connectors") {
  return render(
    <IntegrationsTabs
      active={active}
      plugins={<div>plugin list</div>}
      connectors={<div>connector list</div>}
    />,
  );
}

describe("IntegrationsTabs", () => {
  it("opens the tab that the URL names", () => {
    renderTabs("connectors");
    expect(screen.getByText("connector list")).toBeInTheDocument();
    expect(screen.queryByText("plugin list")).not.toBeInTheDocument();
  });

  it("shows the plugins tab first by default", () => {
    renderTabs("plugins");
    expect(screen.getByText("plugin list")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Plugins" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Connectors" })).toBeInTheDocument();
  });

  it("writes the selected tab to the URL", async () => {
    renderTabs("plugins");
    await userEvent.click(screen.getByRole("tab", { name: "Connectors" }));
    expect(mockReplace).toHaveBeenCalledWith("/dashboard/integrations?tab=connectors", { scroll: false });
    expect(screen.getByText("connector list")).toBeInTheDocument();
  });
});
