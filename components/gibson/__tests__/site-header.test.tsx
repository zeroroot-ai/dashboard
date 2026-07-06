/**
 * SiteHeader nav-link tests (dashboard#963).
 *
 * The docs link must point at the marketing host on SaaS. An app-relative
 * /docs href gets RSC-prefetched by Next.js; the middleware host-split 307s
 * it to www.<domain> and the cross-origin prefetch dies on CORS, producing a
 * console error on every page that renders the public header. An absolute
 * external href is never RSC-prefetched, so the error (and the wasted 307 on
 * real navigation) disappears.
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

const WWW = "https://www.staging.zeroroot.ai";

function profile(marketingUrl: string | null) {
  return {
    selfServeSignup: marketingUrl !== null,
    billingEnabled: marketingUrl !== null,
    marketingUrl,
  };
}

describe("SiteHeader nav links", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue(null);
  });

  it("SaaS: docs link is an absolute marketing-host URL (no RSC prefetch, no cross-host 307)", async () => {
    mockGetDeploymentProfile.mockReturnValue(profile(WWW));

    render(await SiteHeader());

    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "href",
      `${WWW}/docs`,
    );
    // Pricing already followed this pattern — assert it stays that way.
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
