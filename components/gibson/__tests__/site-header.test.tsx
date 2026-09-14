// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * SiteHeader nav-link tests.
 *
 * On SaaS the docs link must point at the DOCS host and the pricing link at
 * the MARKETING host. They are two deployables on two hosts, and this test
 * used to assert `${marketingUrl}/docs` — a path the marketing site does not
 * serve and answers 404 for. The header was the last copy of a rule
 * src/lib/host-routing.ts had already corrected.
 *
 * Both hrefs are absolute for a second reason (dashboard#963): an app-relative
 * /docs href gets RSC-prefetched by Next.js, the middleware host-split 307s
 * it cross-origin, and the prefetch dies on CORS — a console error on every
 * page that renders the public header.
 *
 * On self-hosted (marketingUrl null) the dashboard serves /docs itself, so
 * the relative link is the correct one there — mirroring how the pricing
 * link already handles the same split (rendered SaaS-only).
 *
 * Test strategy: SiteHeader is an async Server Component; we await the
 * element and render it, mocking the session and deployment-profile
 * boundaries (prior art: app/(public)/signup/__tests__/
 * signup-page-closed-registration.test.tsx).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { mockGetServerSession, mockGetDeploymentProfile } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockGetDeploymentProfile: vi.fn(),
}));

vi.mock("@/src/lib/auth", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("@/src/lib/deployment-profile", () => ({
  getDeploymentProfile: mockGetDeploymentProfile,
}));

vi.mock("@/components/layout/logo", () => ({
  Lockup: () => <span data-testid="lockup" />,
}));

import { SiteHeader } from "../site-header";

const WWW = "https://www.zeroroot.ai";
const DOCS = "https://docs.zeroroot.ai";

function profile(marketingUrl: string | null) {
  return {
    selfServeSignup: marketingUrl !== null,
    billingEnabled: marketingUrl !== null,
    marketingUrl,
    docsUrl: DOCS,
  };
}

describe("SiteHeader nav links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue(null);
  });

  it("SaaS: docs links to the docs host, pricing to the marketing host", async () => {
    mockGetDeploymentProfile.mockReturnValue(profile(WWW));

    render(await SiteHeader());

    // Not `${WWW}/docs`: the marketing site serves no /docs.
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "href",
      DOCS,
    );
    expect(screen.getByRole("link", { name: "pricing" })).toHaveAttribute(
      "href",
      `${WWW}/pricing`,
    );
  });

  it("self-hosted: docs link stays app-relative (dashboard serves /docs itself) and pricing is omitted", async () => {
    mockGetDeploymentProfile.mockReturnValue(profile(null));

    render(await SiteHeader());

    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "href",
      "/docs",
    );
    expect(
      screen.queryByRole("link", { name: "pricing" }),
    ).not.toBeInTheDocument();
  });
});
