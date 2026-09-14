// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import Link from "next/link";
import { getServerSession } from "@/src/lib/auth";
import { getDeploymentProfile } from "@/src/lib/deployment-profile";
import { Lockup } from "@/components/layout/logo";

/**
 * Product chrome — shown on login, signup, onboarding, and other public/auth
 * pages of the dashboard.
 *
 * External links are driven by the deployment-profile resolver (dashboard#924
 * / PRD dashboard#920): when `marketingUrl` is null (self-hosted), no
 * off-cluster marketing links are rendered. When set (SaaS), pricing points at
 * `${marketingUrl}/pricing` and docs point at `docsUrl` — two different hosts,
 * because they are two different deployables (ADR-0006, ADR-0077).
 *
 * Brand lockup: full BrainCRT mark (with monitor stand, "the actual terminal")
 * sitting next to the "zeroroot.ai" wordmark. Same treatment as the square
 * 75mm sticker in the brand guide. Mark uses var(--primary); wordmark uses
 * var(--foreground); ".ai" dims to var(--muted-foreground).
 */
export async function SiteHeader() {
  const session = await getServerSession();
  // Resolve the deployment posture once at this server boundary.
  // marketingUrl is null on self-hosted (WWW_URL unset), non-null on SaaS.
  // dashboard#924 / PRD dashboard#920 / deploy ADR-0006.
  const { marketingUrl, docsUrl } = getDeploymentProfile();

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
        <Link
          href="/"
          aria-label="Zero Root AI, home"
          className="inline-flex items-center"
        >
          <Lockup size="md" />
        </Link>
        <nav className="flex items-center gap-6 font-mono text-sm" aria-label="Primary">
          {/* Docs are their own deployable on their own host. This link used
              to be `${marketingUrl}/docs`, from back when the marketing host
              and the docs were one Next app; the marketing site serves no
              /docs and answered 404 for it. src/lib/host-routing.ts had
              already moved to a docs origin and says so in as many words —
              the header was the copy that never followed.

              An app-relative /docs link is still wrong in SaaS for a separate
              reason: Next.js RSC-prefetches it and the middleware 307 kills
              that prefetch on CORS, a console error on every page with this
              nav (dashboard#963). So link the docs host directly.

              On self-hosted (marketingUrl null) the dashboard serves /docs
              itself, so the relative link is correct there. */}
          <Link
            href={marketingUrl !== null ? docsUrl : "/docs"}
            className="text-foreground transition-colors hover:text-link"
          >
            docs
          </Link>
          {/* Pricing link is SaaS-only (dashboard#924). Omitted on self-hosted
              (marketingUrl null) so there is never a dead link to an absent site. */}
          {marketingUrl !== null && (
            <Link
              href={`${marketingUrl}/pricing`}
              className="text-foreground transition-colors hover:text-link"
            >
              pricing
            </Link>
          )}
          {session?.user ? (
            <Link
              href="/dashboard"
              className="text-foreground transition-colors hover:text-link"
            >
              dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-foreground transition-colors hover:text-link"
            >
              sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
