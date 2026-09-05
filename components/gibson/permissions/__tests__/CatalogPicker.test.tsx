/**
 * CatalogPicker connector-grant tests (ADR-0067, dashboard#1128).
 *
 * The picker lists enabled connectors from listAccessibleComponentsAction
 * (DiscoveryService.ListConnectors) and emits the standard GrantSelection
 * with a component:connector/<id> ref, so writeAgentGrantsAction can write
 * a per-agent connector grant with zero new plumbing. The connector is
 * only ever the object of the grant; the target principal stays an
 * agent / tool / plugin principal.
 *
 * The PermissionsTab test closes the round trip: a direct can_execute
 * grant on a connector ref renders in the Direct grants list.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  CatalogPicker,
  type GrantSelection,
} from "@/components/gibson/permissions/CatalogPicker";
import { PermissionsTab } from "@/components/gibson/permissions/PermissionsTab";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const listAccessibleComponentsAction = vi.fn();
vi.mock("@/app/actions/read/listAccessibleComponents", () => ({
  listAccessibleComponentsAction: (...args: unknown[]) =>
    listAccessibleComponentsAction(...args),
}));

vi.mock("@/app/actions/agent-permissions", () => ({
  writeAgentGrantsAction: vi.fn(),
  deleteAgentGrantsAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

function stubCatalogFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      const body = u.includes("plugins")
        ? { plugins: [] }
        : { components: [] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

function renderPicker(props: {
  selected: GrantSelection[];
  onChange: (next: GrantSelection[]) => void;
  excludeAlreadyGranted?: GrantSelection[];
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <CatalogPicker kind="agent" {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  stubCatalogFetch();
  listAccessibleComponentsAction.mockResolvedValue({
    ok: true,
    data: [
      {
        name: "gitlab",
        displayName: "GitLab",
        description: "Source control integration",
        kind: "connector",
        rwx: { read: true, write: true, execute: true },
        denyingGates: [],
        version: "1.0.0",
      },
    ],
  });
});

// ---------------------------------------------------------------------------
// CatalogPicker
// ---------------------------------------------------------------------------

describe("CatalogPicker connectors section", () => {
  it("lists enabled connectors from DiscoveryService", async () => {
    renderPicker({ selected: [], onChange: vi.fn() });

    expect(await screen.findByText("Connectors (1)")).toBeTruthy();
    expect(screen.getByText("GitLab")).toBeTruthy();
    expect(listAccessibleComponentsAction).toHaveBeenCalledWith({
      kind: "connector",
    });
  });

  it("emits a component:connector/<id> execute selection", async () => {
    const onChange = vi.fn();
    renderPicker({ selected: [], onChange });

    const exec = await screen.findByRole("checkbox", {
      name: "can_execute on GitLab",
    });
    await userEvent.click(exec);

    expect(onChange).toHaveBeenCalledWith([
      { componentRef: "component:connector/gitlab", relation: "can_execute" },
    ]);
  });

  it("offers read and write (can_configure) on connector rows too", async () => {
    renderPicker({ selected: [], onChange: vi.fn() });

    expect(
      await screen.findByRole("checkbox", { name: "can_read on GitLab" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("checkbox", { name: "can_configure on GitLab" }),
    ).toBeTruthy();
  });

  it("disables a connector grant the principal already has", async () => {
    renderPicker({
      selected: [],
      onChange: vi.fn(),
      excludeAlreadyGranted: [
        { componentRef: "component:connector/gitlab", relation: "can_execute" },
      ],
    });

    const exec = await screen.findByRole("checkbox", {
      name: "can_execute on GitLab",
    });
    expect(exec).toHaveProperty("disabled", true);
  });

  it("shows the connectors empty state when none are enabled", async () => {
    listAccessibleComponentsAction.mockResolvedValue({ ok: true, data: [] });
    renderPicker({ selected: [], onChange: vi.fn() });

    await waitFor(() => {
      // Everything is empty, so the tenant-catalog empty state renders.
      expect(screen.getByText("Your tenant catalog is empty")).toBeTruthy();
    });
  });

  it("surfaces a connector listing failure without killing the picker", async () => {
    listAccessibleComponentsAction.mockResolvedValue({
      ok: false,
      error: "discovery unavailable",
    });
    renderPicker({ selected: [], onChange: vi.fn() });

    expect(await screen.findByText("Could not load connectors")).toBeTruthy();
    expect(screen.getByText("discovery unavailable")).toBeTruthy();
    // The components section is still there.
    expect(screen.getByText("Components (0)")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PermissionsTab round trip
// ---------------------------------------------------------------------------

describe("PermissionsTab renders connector grants", () => {
  it("shows a direct can_execute connector grant in Direct grants", () => {
    render(
      <PermissionsTab
        principalId="agent_principal:demo"
        kind="agent"
        componentGrants={[
          {
            componentRef: "component:connector/gitlab",
            canRead: false,
            canConfigure: false,
            canExecute: true,
            sources: [{ kind: "KIND_DIRECT", sourceObject: "" }],
          },
        ]}
        pluginGrants={[]}
        activeCapabilityGrants={[]}
      />,
    );

    expect(screen.getByText("Direct grants (1)")).toBeTruthy();
    expect(screen.getByText("component:connector/gitlab")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Remove component:connector/gitlab can_execute",
      }),
    ).toBeTruthy();
  });
});
