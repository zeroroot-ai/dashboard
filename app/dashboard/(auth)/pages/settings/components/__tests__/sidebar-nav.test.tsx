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

describe("settings SidebarNav — member-management IA (#606)", () => {
  it("renders Members exactly once, gated on ListMembers (not the secrets-broker RPC)", () => {
    // Allow the member-list RPC; deny the secrets-broker config RPC. If the
    // duplicate Members entry mis-gated on GetBrokerConfig still existed, it
    // would be hidden here (broker denied) while the canonical one shows —
    // so a single match proves the dedup AND the correct gate.
    allowByMethod["/gibson.admin.v1.TenantAdminService/ListMembers"] = true;
    allowByMethod["/gibson.admin.v1.TenantAdminService/GetBrokerConfig"] = false;
    allowByMethod["/gibson.admin.v1.SecretsAdminService/ListSecrets"] = true;
    allowByMethod["/gibson.admin.v1.GrantsAdminService/ListActiveGrants"] = true;

    render(<SidebarNav />);

    const members = screen.getAllByRole("link", { name: /members/i });
    expect(members).toHaveLength(1);
    expect(members[0]).toHaveAttribute(
      "href",
      "/dashboard/pages/settings/members",
    );

    // Secret Broker is the GetBrokerConfig-gated entry — denied here, so it
    // must be absent. This confirms Members is no longer riding that gate.
    expect(
      screen.queryByRole("link", { name: /secret broker/i }),
    ).toBeNull();
  });

  it("hides Members when the member-list RPC is denied", () => {
    allowByMethod["/gibson.admin.v1.TenantAdminService/ListMembers"] = false;
    allowByMethod["/gibson.admin.v1.TenantAdminService/GetBrokerConfig"] = true;

    render(<SidebarNav />);

    expect(screen.queryByRole("link", { name: /members/i })).toBeNull();
  });
});
