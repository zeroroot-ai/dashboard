/**
 * AccessScopeSelector — component tests.
 *
 * Covers the on-demand population of the per-team / per-user / per-agent
 * dropdowns (dashboard#698/#699/#700) and the prop-override path.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import {
  AccessScopeSelector,
  type AccessScopeSelection,
} from "../AccessScopeSelector";

// ---------------------------------------------------------------------------
// jsdom polyfills required to open a Radix Select
// ---------------------------------------------------------------------------
beforeEach(() => {
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

// ---------------------------------------------------------------------------
// Mock the read Server Actions (imported before SUT via hoisting)
// ---------------------------------------------------------------------------
vi.mock("@/app/actions/crd/teams", () => ({
  listTeamsAction: vi.fn(),
}));
vi.mock("@/app/actions/read/listMembers", () => ({
  listMembersAction: vi.fn(),
}));
vi.mock("@/app/actions/read/listAgentIdentities", () => ({
  listAgentIdentitiesAction: vi.fn(),
}));

import { listTeamsAction } from "@/app/actions/crd/teams";
import { listMembersAction } from "@/app/actions/read/listMembers";
import { listAgentIdentitiesAction } from "@/app/actions/read/listAgentIdentities";

const mockTeams = vi.mocked(listTeamsAction);
const mockMembers = vi.mocked(listMembersAction);
const mockAgents = vi.mocked(listAgentIdentitiesAction);

beforeEach(() => {
  vi.clearAllMocks();
});

/** Controlled harness so tab clicks actually change scope. */
function Harness({
  initial = { scope: "tenant-wide" } as AccessScopeSelection,
  ...props
}: Partial<React.ComponentProps<typeof AccessScopeSelector>> & {
  initial?: AccessScopeSelection;
}) {
  const [value, setValue] = useState<AccessScopeSelection>(initial);
  return (
    <AccessScopeSelector value={value} onChange={setValue} {...props} />
  );
}

describe("AccessScopeSelector", () => {
  it("fetches and populates the per-team dropdown on demand", async () => {
    mockTeams.mockResolvedValue({
      ok: true,
      data: [
        { id: "red-team", displayName: "Red Team", memberCount: 3 },
        { id: "blue-team", displayName: "Blue Team", memberCount: 2 },
      ],
    });
    const user = userEvent.setup();

    render(<Harness />);
    // Teams are not fetched until the Per-team scope is selected.
    expect(mockTeams).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "Per-team" }));

    await waitFor(() => expect(mockTeams).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeEnabled(),
    );
    await user.click(screen.getByRole("combobox"));

    await waitFor(() =>
      expect(screen.getByText("Red Team")).toBeInTheDocument(),
    );
    expect(screen.getByText("Blue Team")).toBeInTheDocument();
  });

  it("fetches and populates the per-user dropdown on demand", async () => {
    mockMembers.mockResolvedValue({
      ok: true,
      data: [
        {
          userId: "u1",
          displayName: "Ada Lovelace",
          email: "ada@example.com",
          role: "tenant_admin",
          joinedAt: "",
          status: "active",
        },
      ],
    });
    const user = userEvent.setup();

    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "Per-user" }));
    await waitFor(() => expect(mockMembers).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeEnabled(),
    );
    await user.click(screen.getByRole("combobox"));
    await waitFor(() =>
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument(),
    );
  });

  it("fetches and populates the per-agent dropdown on demand", async () => {
    mockAgents.mockResolvedValue({
      ok: true,
      data: [{ id: "principal-1", name: "recon-bot" }],
    });
    const user = userEvent.setup();

    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "Per-agent" }));
    await waitFor(() => expect(mockAgents).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeEnabled(),
    );
    await user.click(screen.getByRole("combobox"));
    await waitFor(() =>
      expect(screen.getByText("recon-bot")).toBeInTheDocument(),
    );
  });

  it("emits the selected team id via onChange", async () => {
    mockTeams.mockResolvedValue({
      ok: true,
      data: [{ id: "red-team", displayName: "Red Team", memberCount: 1 }],
    });
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(
      <AccessScopeSelector value={{ scope: "per-team" }} onChange={onChange} />,
    );
    await waitFor(() => expect(mockTeams).toHaveBeenCalled());

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeEnabled(),
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Red Team"));

    expect(onChange).toHaveBeenLastCalledWith({
      scope: "per-team",
      targetId: "red-team",
    });
  });

  it("uses the teams prop as an override and skips the fetch", async () => {
    const user = userEvent.setup();
    render(<Harness teams={[{ id: "prop-team", name: "Prop Team" }]} />);
    await user.click(screen.getByRole("tab", { name: "Per-team" }));

    await waitFor(() =>
      expect(screen.getByRole("combobox")).toBeEnabled(),
    );
    await user.click(screen.getByRole("combobox"));
    await waitFor(() =>
      expect(screen.getByText("Prop Team")).toBeInTheDocument(),
    );
    expect(mockTeams).not.toHaveBeenCalled();
  });
});
