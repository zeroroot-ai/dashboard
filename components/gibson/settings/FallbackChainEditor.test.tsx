/**
 * FallbackChainEditor tests
 *
 * Validates:
 * - Component does not render when < 2 providers are configured
 * - Ranked and unranked sections appear when 2+ providers exist
 * - Save order button fires PUT /api/settings/providers/fallback-chain
 * - Rank badge "#1" appears on the first provider card in the chain
 */

import React from "react";
import { describe, it, expect, beforeEach, vi, type MockedFunction } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { FallbackChainEditor } from "./FallbackChainEditor";
import type { ProviderConfig } from "@/src/types/provider";

// ---------------------------------------------------------------------------
// Silence sonner in tests
// ---------------------------------------------------------------------------

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Silence dnd-kit pointer events (jsdom does not implement them)
// ---------------------------------------------------------------------------

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: React.PropsWithChildren<{ onDragEnd?: unknown }>) => (
      // Expose onDragEnd on the element so tests can call it if needed
      <div data-testid="dnd-context" data-on-drag-end={String(onDragEnd)}>
        {children}
      </div>
    ),
  };
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    name: "provider-a",
    displayName: "Provider A",
    type: "anthropic",
    isDefault: false,
    isEnabled: true,
    version: 1,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const providerA = makeProvider({ name: "provider-a", displayName: "Provider A" });
const providerB = makeProvider({ name: "provider-b", displayName: "Provider B" });
const providerC = makeProvider({ name: "provider-c", displayName: "Provider C" });

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function renderFCE(providers: ProviderConfig[], queryClient?: QueryClient) {
  const qc = queryClient ?? createTestQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <FallbackChainEditor providers={providers} />
    </QueryClientProvider>,
  );
}

// Helper to mock global.fetch for the fallback-chain endpoint
function mockFetch(chain: string[]) {
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (String(url).includes("/api/settings/providers/fallback-chain")) {
      if (!init?.method || init.method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify({ chain }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (init.method === "PUT") {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
    }
    return Promise.reject(new Error(`Unexpected fetch: ${String(url)}`));
  });

  global.fetch = fetchMock as typeof global.fetch;
  return fetchMock as MockedFunction<typeof global.fetch>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FallbackChainEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Visibility guard
  // -------------------------------------------------------------------------

  it("does not render when fewer than 2 providers are configured", () => {
    const { container } = renderFCE([]);
    expect(container.firstChild).toBeNull();
  });

  it("does not render when exactly 1 provider is configured", () => {
    const { container } = renderFCE([providerA]);
    expect(container.firstChild).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Basic render with 2+ providers
  // -------------------------------------------------------------------------

  it("renders the Fallback chain card when 2+ providers are configured", async () => {
    mockFetch([]);
    renderFCE([providerA, providerB]);

    await waitFor(() => {
      expect(screen.getByText("Fallback chain")).toBeInTheDocument();
    });
  });

  it("shows providers in ranked section when chain is populated", async () => {
    mockFetch(["provider-a", "provider-b"]);
    renderFCE([providerA, providerB]);

    await waitFor(() => {
      // Both provider names should appear
      expect(screen.getByText("provider-a")).toBeInTheDocument();
      expect(screen.getByText("provider-b")).toBeInTheDocument();
      // No "Not in fallback chain" separator (all are ranked)
      expect(screen.queryByText("Not in fallback chain")).not.toBeInTheDocument();
    });
  });

  it("shows unranked section when some providers are not in the chain", async () => {
    mockFetch(["provider-a"]);
    renderFCE([providerA, providerB, providerC]);

    await waitFor(() => {
      expect(screen.getByText("Not in fallback chain")).toBeInTheDocument();
      // provider-b and provider-c are unranked
      const allProviderNames = screen.getAllByText(/provider-[abc]/);
      expect(allProviderNames.length).toBeGreaterThanOrEqual(3);
    });
  });

  it("shows empty-chain message when no providers are in the chain", async () => {
    mockFetch([]);
    renderFCE([providerA, providerB]);

    await waitFor(() => {
      expect(
        screen.getByText(/No providers in the fallback chain/i),
      ).toBeInTheDocument();
      // Both should appear as unranked
      expect(screen.getByText("Not in fallback chain")).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Save order button
  // -------------------------------------------------------------------------

  it("fires PUT /api/settings/providers/fallback-chain with correct body on save", async () => {
    const fetchMock = mockFetch(["provider-a", "provider-b"]);
    const user = userEvent.setup();
    renderFCE([providerA, providerB]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /save order/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /save order/i }));

    await waitFor(() => {
      const putCalls = fetchMock.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/api/settings/providers/fallback-chain") &&
          (init as RequestInit)?.method === "PUT",
      );
      expect(putCalls.length).toBe(1);
      const body = JSON.parse((putCalls[0][1] as RequestInit).body as string) as {
        chain: string[];
      };
      expect(body.chain).toEqual(["provider-a", "provider-b"]);
    });
  });

  // -------------------------------------------------------------------------
  // Rank badge
  // -------------------------------------------------------------------------

  it("shows rank badge '#1' for the first provider in the chain", async () => {
    mockFetch(["provider-a", "provider-b"]);
    renderFCE([providerA, providerB]);

    await waitFor(() => {
      expect(screen.getByText("#1")).toBeInTheDocument();
      expect(screen.getByText("#2")).toBeInTheDocument();
    });
  });

  it("does not show rank badges when the chain is empty", async () => {
    mockFetch([]);
    renderFCE([providerA, providerB]);

    await waitFor(() => {
      expect(screen.queryByText(/#\d/)).not.toBeInTheDocument();
    });
  });
});
