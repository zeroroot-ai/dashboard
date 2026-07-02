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

import { SidebarNav } from "../sidebar-nav";

describe("settings SidebarNav, member-management IA (#609)", () => {
  it("does NOT render a Members entry, member management lives in the Organization 'Members & Access' home", () => {
    // Allow everything; Members must still be absent from Settings (it was
    // consolidated into the Organization nav per ADR-0039 / #609).
    allowByMethod["/gibson.tenant.v1.SecretsService/ListSecrets"] = true;
    allowByMethod["/gibson.tenant.v1.SecretsService/GetBrokerConfig"] = true;
    allowByMethod["/gibson.tenant.v1.GrantsService/ListActiveGrants"] = true;

    render(<SidebarNav />);

    expect(screen.queryByRole("link", { name: /members/i })).toBeNull();
    // The remaining admin entries still render and are gated on their real RPC.
    expect(
      screen.getByRole("link", { name: /secret broker/i }),
    ).toBeInTheDocument();
  });

  it("hides admin entries whose backing RPC is denied", () => {
    allowByMethod["/gibson.tenant.v1.SecretsService/ListSecrets"] = false;
    allowByMethod["/gibson.tenant.v1.SecretsService/GetBrokerConfig"] = false;
    allowByMethod["/gibson.tenant.v1.GrantsService/ListActiveGrants"] = false;

    render(<SidebarNav />);

    expect(screen.queryByRole("link", { name: /secret broker/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /permissions/i })).toBeNull();
  });
});
