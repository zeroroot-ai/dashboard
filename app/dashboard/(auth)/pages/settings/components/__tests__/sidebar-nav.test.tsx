// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Per-RPC authorization is mocked so we can assert which nav entries render
// and on which RPC they are gated.
const allowByMethod: Record<string, boolean> = {};
vi.mock("@/src/lib/auth/use-authorize", () => ({
  useAuthorize: (method: string) => ({
    allowed: allowByMethod[method] ?? false,
    loading: false,
  }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/pages/settings/account",
}));

// The viewer's role in the active tenant drives the account link.
const tenant = { id: "acme", role: "member" };
vi.mock("@/src/lib/auth/tenant", () => ({
  useTenantId: () => tenant.id,
}));
vi.mock("@/src/lib/tenant-context", () => ({
  useTenantContext: () => ({ rolesByTenant: { [tenant.id]: tenant.role } }),
}));

/** A test fixture, not product text. */
const ACCOUNT_LINK = { url: "https://account.example.test/portal", label: "account-label" };

import { SidebarNav } from "../sidebar-nav";

describe("settings SidebarNav, member-management IA (#609)", () => {
  it("does NOT render a Members entry, member management lives in the Organization 'Members & Access' home", () => {
    // Allow everything; Members must still be absent from Settings (it was
    // consolidated into the Organization nav, see #609).
    allowByMethod["/gibson.secrets.v1.SecretsService/ListSecrets"] = true;
    allowByMethod["/gibson.secrets.v1.SecretsService/GetBrokerConfig"] = true;
    allowByMethod["/gibson.tenant.v1.GrantsService/ListActiveGrants"] = true;

    render(<SidebarNav accountLink={null} />);

    expect(screen.queryByRole("link", { name: /members/i })).toBeNull();
    // The remaining admin entries still render and are gated on their real RPC.
    expect(
      screen.getByRole("link", { name: /secret broker/i }),
    ).toBeInTheDocument();
  });

  it("hides admin entries whose backing RPC is denied", () => {
    allowByMethod["/gibson.secrets.v1.SecretsService/ListSecrets"] = false;
    allowByMethod["/gibson.secrets.v1.SecretsService/GetBrokerConfig"] = false;
    allowByMethod["/gibson.tenant.v1.GrantsService/ListActiveGrants"] = false;

    render(<SidebarNav accountLink={null} />);

    expect(screen.queryByRole("link", { name: /secret broker/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /permissions/i })).toBeNull();
  });
});

describe("settings SidebarNav, account link (dashboard#226)", () => {
  it("shows the account link from config to the tenant Owner", () => {
    tenant.role = "owner";
    render(<SidebarNav accountLink={ACCOUNT_LINK} />);
    const link = screen.getByRole("link", { name: /account-label/ });
    expect(link).toHaveAttribute("href", ACCOUNT_LINK.url);
  });

  it("hides the account link from every other role", () => {
    for (const role of ["admin", "member", "viewer"]) {
      tenant.role = role;
      const { unmount } = render(<SidebarNav accountLink={ACCOUNT_LINK} />);
      expect(screen.queryByRole("link", { name: /account-label/ })).toBeNull();
      unmount();
    }
  });

  it("shows no account link and no Billing entry with no account URL", () => {
    tenant.role = "owner";
    render(<SidebarNav accountLink={null} />);
    expect(screen.queryByRole("link", { name: /account-label/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /billing/i })).toBeNull();
  });
});
