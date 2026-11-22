// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

import { navItems } from "../nav-main";

const operations = navItems.find((g) => g.title === "Operations");

describe("the first level of the navigation", () => {
  const topTitles = (operations?.items ?? []).map((i) => i.title);

  it("keeps Missions, Mission Results, Traces and the two queues off the first level", () => {
    for (const title of ["Missions", "Mission Results", "Traces", "Review Queue", "Settle Queue"]) {
      expect(topTitles, `${title} must sit one level down`).not.toContain(title);
    }
  });

  it("keeps the Dashboard and the Findings on the first level", () => {
    expect(topTitles).toContain("Dashboard");
    expect(topTitles).toContain("Findings");
  });

  it("holds the moved entries under one parent, with the grants gated", () => {
    const parent = operations?.items.find((i) => i.items && i.items.length > 0 && i.title === "Agent activity");
    expect(parent).toBeDefined();
    const subs = parent?.items ?? [];
    expect(subs.map((s) => s.title)).toEqual([
      "Missions",
      "Mission Results",
      "Grants",
      "Traces",
      "Review Queue",
      "Settle Queue",
    ]);
    expect(subs.find((s) => s.title === "Grants")).toMatchObject({
      href: "/dashboard/pages/settings/grants",
      gate: "grants",
    });
    expect(subs.find((s) => s.title === "Review Queue")?.href).toBe("/dashboard/review");
    expect(subs.find((s) => s.title === "Settle Queue")?.href).toBe("/dashboard/hitl-settle");
  });

  it("links the Usage page from the Configuration group", () => {
    const config = navItems.find((g) => g.title === "Configuration");
    expect(config?.items.find((i) => i.title === "Usage")?.href).toBe("/dashboard/pages/usage");
  });
});
