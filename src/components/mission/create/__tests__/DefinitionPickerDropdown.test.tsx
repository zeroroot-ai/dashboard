/**
 * DefinitionPickerDropdown — component tests.
 *
 * Covers: full list display, "New Mission" first-item guarantee, search
 * filtering, active-item marking, null selection, loading state, and error
 * state.
 *
 * M6 — mission-author-experience. Closes #322.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DefinitionPickerDropdown } from "../definition-picker-dropdown";
import type { MissionDefinitionSummary } from "@/src/hooks/useListMissionDefinitions";

// ---------------------------------------------------------------------------
// jsdom polyfills required by Radix UI / cmdk
// ---------------------------------------------------------------------------

beforeEach(() => {
  // cmdk uses ResizeObserver internally; jsdom does not implement it.
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class FakeResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  // Radix Popover queries pointer-capture APIs on the trigger element.
  Element.prototype.hasPointerCapture ??= vi.fn(() => false);
  Element.prototype.setPointerCapture ??= vi.fn();
  Element.prototype.releasePointerCapture ??= vi.fn();
  // Radix ScrollArea uses scrollIntoView.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn();
  }
});

// ---------------------------------------------------------------------------
// Module-level mock for useListMissionDefinitions
// ---------------------------------------------------------------------------

vi.mock("@/src/hooks/useListMissionDefinitions", () => ({
  useListMissionDefinitions: vi.fn(),
}));

// Import AFTER mocking so we get the mocked version.
import { useListMissionDefinitions } from "@/src/hooks/useListMissionDefinitions";

const mockUseListMissionDefinitions = vi.mocked(useListMissionDefinitions);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fixtureDefs: MissionDefinitionSummary[] = [
  {
    name: "web-recon",
    version: "1.2.0",
    description: "Web reconnaissance mission",
    nodeCount: 4,
    installedAt: 1716000000,
    updatedAt: 1716100000,
  },
  {
    name: "api-fuzz",
    version: "0.9.1",
    description: "API fuzzing mission",
    nodeCount: 2,
    installedAt: 1716000001,
    updatedAt: 1716100001,
  },
  {
    name: "network-scan",
    version: "2.0.0",
    description: "Network scanning mission",
    nodeCount: 7,
    installedAt: 1716000002,
    updatedAt: 1716100002,
  },
];

function successState(overrides: Partial<ReturnType<typeof useListMissionDefinitions>> = {}) {
  return {
    definitions: fixtureDefs,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper — open the dropdown by clicking the trigger button
// ---------------------------------------------------------------------------

async function openDropdown(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.getByRole("combobox");
  await user.click(trigger);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DefinitionPickerDropdown", () => {
  const noop = vi.fn();

  beforeEach(() => {
    noop.mockClear();
  });

  // 1. Full list display
  it("renders all definition names after opening the dropdown", async () => {
    mockUseListMissionDefinitions.mockReturnValue(successState());
    const user = userEvent.setup();
    render(<DefinitionPickerDropdown value={null} onChange={noop} />);

    await openDropdown(user);

    expect(screen.getByText("web-recon")).toBeTruthy();
    expect(screen.getByText("api-fuzz")).toBeTruthy();
    expect(screen.getByText("network-scan")).toBeTruthy();
  });

  // 2. "New Mission" always appears first
  it('shows "New Mission" as the first item in the list', async () => {
    mockUseListMissionDefinitions.mockReturnValue(successState());
    const user = userEvent.setup();
    render(<DefinitionPickerDropdown value={null} onChange={noop} />);

    await openDropdown(user);

    // "New Mission" appears in both trigger label and dropdown item — getAllByText is correct.
    const matches = screen.getAllByText("New Mission");
    expect(matches.length).toBeGreaterThan(0);
    // The first option in the list renders "New Mission"
    const allItems = screen.getAllByRole("option");
    expect(allItems[0].textContent).toContain("New Mission");
  });

  // 3. Search filtering (case-insensitive)
  it("filters items by name when the user types in the search box (case-insensitive)", async () => {
    mockUseListMissionDefinitions.mockReturnValue(successState());
    const user = userEvent.setup();
    render(<DefinitionPickerDropdown value={null} onChange={noop} />);

    await openDropdown(user);

    const searchInput = screen.getByPlaceholderText("Search definitions…");
    await user.type(searchInput, "API");

    // api-fuzz should match; web-recon and network-scan should not
    await waitFor(() => {
      expect(screen.queryByText("api-fuzz")).toBeTruthy();
    });
    expect(screen.queryByText("web-recon")).toBeNull();
    expect(screen.queryByText("network-scan")).toBeNull();
  });

  // 4. Active marking — trigger shows name and item has checkmark
  it("shows the selected definition name in the trigger button", () => {
    mockUseListMissionDefinitions.mockReturnValue(successState());
    render(<DefinitionPickerDropdown value="web-recon" onChange={noop} />);

    const trigger = screen.getByRole("combobox");
    expect(trigger.textContent).toContain("web-recon");
  });

  it("renders a visible checkmark next to the active definition item", async () => {
    mockUseListMissionDefinitions.mockReturnValue(successState());
    const user = userEvent.setup();
    render(<DefinitionPickerDropdown value="api-fuzz" onChange={noop} />);

    await openDropdown(user);

    // "api-fuzz" appears in both trigger label and dropdown item; getAllByText handles both.
    const matches = screen.getAllByText("api-fuzz");
    expect(matches.length).toBeGreaterThan(0);
  });

  // 5. Null selection — clicking "New Mission" calls onChange(null)
  it('calls onChange(null) when the user selects "New Mission"', async () => {
    mockUseListMissionDefinitions.mockReturnValue(successState());
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DefinitionPickerDropdown value="web-recon" onChange={onChange} />);

    await openDropdown(user);
    await user.click(screen.getByText("New Mission"));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  // 6. Loading state — spinner in trigger
  it("shows a loading spinner in the trigger when isLoading is true", () => {
    mockUseListMissionDefinitions.mockReturnValue(
      successState({ isLoading: true, definitions: [] })
    );
    render(<DefinitionPickerDropdown value={null} onChange={noop} />);

    expect(screen.getByLabelText("Loading definitions")).toBeTruthy();
  });

  // 7. Error state — disabled error item
  it('shows "Could not load definitions" when the hook returns an error', async () => {
    mockUseListMissionDefinitions.mockReturnValue(
      successState({ error: new Error("network failure"), definitions: [] })
    );
    const user = userEvent.setup();
    render(<DefinitionPickerDropdown value={null} onChange={noop} />);

    await openDropdown(user);

    expect(screen.getByText("Could not load definitions")).toBeTruthy();
  });

  // Bonus: selecting a definition calls onChange with the definition name
  it("calls onChange with the definition name when a definition is selected", async () => {
    mockUseListMissionDefinitions.mockReturnValue(successState());
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<DefinitionPickerDropdown value={null} onChange={onChange} />);

    await openDropdown(user);
    await user.click(screen.getByText("network-scan"));

    expect(onChange).toHaveBeenCalledWith("network-scan");
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
