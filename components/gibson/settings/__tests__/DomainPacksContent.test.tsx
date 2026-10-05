// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * DomainPacksContent — the ADR-0133 Domain Pack catalog panel (gibson#383).
 * Server Actions (app/actions/domain-packs.ts) and useAuthorize are mocked
 * here. This file verifies:
 *   1. Loading, error (fail-loud), empty-catalog, and populated states render.
 *   2. A daemon-unavailable action result renders a distinct error banner
 *      with a Retry control, never a silently empty catalog.
 *   3. The toggle is visible only when useAuthorize allows both RPCs, and
 *      calls enable/disable with the right pack name.
 *   4. A non-admin sees the enabled state as a read-only badge, no toggle.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const mockListDomainPacksAction = vi.fn();
const mockEnableDomainPackAction = vi.fn();
const mockDisableDomainPackAction = vi.fn();
vi.mock("@/app/actions/domain-packs", () => ({
  listDomainPacksAction: (...args: unknown[]) => mockListDomainPacksAction(...args),
  enableDomainPackAction: (...args: unknown[]) => mockEnableDomainPackAction(...args),
  disableDomainPackAction: (...args: unknown[]) => mockDisableDomainPackAction(...args),
}));

const mockUseAuthorize = vi.fn();
vi.mock("@/src/lib/auth/use-authorize", () => ({
  useAuthorize: (method: string) => mockUseAuthorize(method),
}));

import { DomainPacksContent } from "../DomainPacksContent";

const CATALOG_ENTRY = {
  name: "main",
  version: 1,
  author: "zeroroot-ai",
  visibility: "public",
  taxonomyNodeLabels: ["Finding"],
  taxonomyRelationshipTypes: ["DEMONSTRATES"],
  techniques: ["unauthenticated_endpoint_exposed", "credential_disclosure_detected"],
};

function asAdmin() {
  mockUseAuthorize.mockReturnValue({ allowed: true, loading: false });
}

function asMember() {
  mockUseAuthorize.mockReturnValue({ allowed: false, loading: false });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DomainPacksContent", () => {
  it("shows a loading state while the catalog loads", () => {
    asAdmin();
    mockListDomainPacksAction.mockReturnValue(new Promise(() => {})); // never resolves
    render(<DomainPacksContent docsHref="https://docs.example.com/domain-packs" />);
    expect(screen.getByText(/loading domain packs/i)).toBeInTheDocument();
  });

  it("fails loud: a daemon-unavailable result renders a distinct error banner with Retry, never an empty catalog silently", async () => {
    asAdmin();
    mockListDomainPacksAction.mockResolvedValue({
      ok: false,
      error: "Our backend is briefly unavailable. We're already on it, please try again in a moment.",
      code: "unavailable",
    });
    render(<DomainPacksContent docsHref="https://docs.example.com/domain-packs" />);

    await waitFor(() =>
      expect(screen.getByText(/domain pack service is unavailable/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/briefly unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    // Never silently rendered as an empty, non-error catalog state.
    expect(screen.queryByText(/no domain packs are in the catalog/i)).not.toBeInTheDocument();
  });

  it("shows an empty state only when the catalog genuinely has no entries", async () => {
    asAdmin();
    mockListDomainPacksAction.mockResolvedValue({ ok: true, data: { catalog: [], enabled: [] } });
    render(<DomainPacksContent docsHref="https://docs.example.com/domain-packs" />);
    await waitFor(() =>
      expect(screen.getByText(/no domain packs are in the catalog/i)).toBeInTheDocument(),
    );
  });

  it("renders a catalog entry with its techniques and enabled state", async () => {
    asAdmin();
    mockListDomainPacksAction.mockResolvedValue({
      ok: true,
      data: { catalog: [CATALOG_ENTRY], enabled: [] },
    });
    render(<DomainPacksContent docsHref="https://docs.example.com/domain-packs" />);

    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
    expect(screen.getByText(/unauthenticated_endpoint_exposed/)).toBeInTheDocument();
    expect(screen.getByText(/not enabled/i)).toBeInTheDocument();
  });

  it("shows the toggle for an admin and enables a pack on click", async () => {
    asAdmin();
    mockListDomainPacksAction.mockResolvedValue({
      ok: true,
      data: { catalog: [CATALOG_ENTRY], enabled: [] },
    });
    mockEnableDomainPackAction.mockResolvedValue({ ok: true, data: { name: "main", version: 1 } });

    render(<DomainPacksContent docsHref="https://docs.example.com/domain-packs" />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());

    const toggle = screen.getByRole("switch", { name: /enable main/i });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(mockEnableDomainPackAction).toHaveBeenCalledWith("main"),
    );
    // Reloads the catalog after a successful toggle.
    expect(mockListDomainPacksAction).toHaveBeenCalledTimes(2);
  });

  it("disables an already-enabled pack on click", async () => {
    asAdmin();
    mockListDomainPacksAction.mockResolvedValue({
      ok: true,
      data: {
        catalog: [CATALOG_ENTRY],
        enabled: [{ name: "main", version: 1, techniques: CATALOG_ENTRY.techniques }],
      },
    });
    mockDisableDomainPackAction.mockResolvedValue({ ok: true, data: null });

    render(<DomainPacksContent docsHref="https://docs.example.com/domain-packs" />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());

    const toggle = screen.getByRole("switch", { name: /disable main/i });
    await userEvent.click(toggle);

    await waitFor(() =>
      expect(mockDisableDomainPackAction).toHaveBeenCalledWith("main"),
    );
  });

  it("hides the toggle for a non-admin and shows a read-only badge instead", async () => {
    asMember();
    mockListDomainPacksAction.mockResolvedValue({
      ok: true,
      data: {
        catalog: [CATALOG_ENTRY],
        enabled: [{ name: "main", version: 1, techniques: CATALOG_ENTRY.techniques }],
      },
    });

    render(<DomainPacksContent docsHref="https://docs.example.com/domain-packs" />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());

    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });
});
