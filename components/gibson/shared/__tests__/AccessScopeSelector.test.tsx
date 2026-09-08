// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * AccessScopeSelector, component tests.
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

/**
 * `userEvent.setup()` defaults to `delay: 0`, which parks on a macrotask after
 * every simulated event. A macrotask wait is unbounded on a saturated event
 * loop, so under a full parallel `pnpm test` run the duration of these tests
 * tracked machine contention instead of the work they do, and the first test
 * in the file crossed the 5 s per-test budget (dashboard#10). `delay: null`
 * advances the event sequence synchronously, so the cost is the render work
 * and nothing else. Every assertion below is awaited, so removing the delay
 * removes wall-clock dependence rather than hiding it.
 */
function setupUser() {
  return userEvent.setup({ delay: null });
}

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
  // `mockReset` drops the implementation as well as the call log, so no test
  // can inherit a resolved value from the test before it. Each test installs
  // its own already-resolved value, so the selector never waits on a promise
  // that something else settles.
  mockTeams.mockReset();
  mockMembers.mockReset();
  mockAgents.mockReset();
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

/** The trigger starts disabled and enables when the fetched list arrives. */
async function openPopulatedDropdown(user: ReturnType<typeof setupUser>) {
  const trigger = await screen.findByRole("combobox");
  await waitFor(() => expect(trigger).toBeEnabled());
  await user.click(trigger);
  return trigger;
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
    const user = setupUser();

    render(<Harness />);
    // Teams are not fetched until the Per-team scope is selected.
    expect(mockTeams).not.toHaveBeenCalled();

    await user.click(screen.getByRole("tab", { name: "Per-team" }));

    await waitFor(() => expect(mockTeams).toHaveBeenCalledTimes(1));

    await openPopulatedDropdown(user);

    expect(await screen.findByText("Red Team")).toBeInTheDocument();
    expect(await screen.findByText("Blue Team")).toBeInTheDocument();
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
    const user = setupUser();

    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "Per-user" }));
    await waitFor(() => expect(mockMembers).toHaveBeenCalledTimes(1));

    await openPopulatedDropdown(user);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("fetches and populates the per-agent dropdown on demand", async () => {
    mockAgents.mockResolvedValue({
      ok: true,
      data: [{ id: "principal-1", name: "recon-bot" }],
    });
    const user = setupUser();

    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "Per-agent" }));
    await waitFor(() => expect(mockAgents).toHaveBeenCalledTimes(1));

    await openPopulatedDropdown(user);

    expect(await screen.findByText("recon-bot")).toBeInTheDocument();
  });

  it("emits the selected team id via onChange", async () => {
    mockTeams.mockResolvedValue({
      ok: true,
      data: [{ id: "red-team", displayName: "Red Team", memberCount: 1 }],
    });
    const onChange = vi.fn();
    const user = setupUser();

    render(
      <AccessScopeSelector value={{ scope: "per-team" }} onChange={onChange} />,
    );
    await waitFor(() => expect(mockTeams).toHaveBeenCalled());

    await openPopulatedDropdown(user);
    await user.click(await screen.findByText("Red Team"));

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        scope: "per-team",
        targetId: "red-team",
      }),
    );
  });

  it("uses the teams prop as an override and skips the fetch", async () => {
    const user = setupUser();
    render(<Harness teams={[{ id: "prop-team", name: "Prop Team" }]} />);
    await user.click(screen.getByRole("tab", { name: "Per-team" }));

    await openPopulatedDropdown(user);

    expect(await screen.findByText("Prop Team")).toBeInTheDocument();
    expect(mockTeams).not.toHaveBeenCalled();
  });
});
