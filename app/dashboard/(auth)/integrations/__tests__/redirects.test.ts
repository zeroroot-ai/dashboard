// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The old top-level routes redirect to the matching tab of the one
 * Integrations page (dashboard#86).
 */

import { describe, it, expect, vi } from "vitest";

const { mockRedirect } = vi.hoisted(() => ({
  mockRedirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));

import PluginsRedirect from "../../plugins/page";
import ConnectorsRedirect from "../../connectors/page";
import ConnectorsSettingsRedirect from "../../pages/settings/connectors/page";

describe("the old Integrations routes", () => {
  it.each([
    ["/dashboard/plugins", PluginsRedirect, "/dashboard/integrations?tab=plugins"],
    ["/dashboard/connectors", ConnectorsRedirect, "/dashboard/integrations?tab=connectors"],
    ["/dashboard/pages/settings/connectors", ConnectorsSettingsRedirect, "/dashboard/integrations?tab=connectors"],
  ])("%s redirects to %s", (_route, page, target) => {
    expect(() => page()).toThrow(`redirect:${target}`);
  });
});
