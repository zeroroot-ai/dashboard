import Link from "next/link";
import { getServerSession } from "@/src/lib/auth";
import { getDeploymentProfile } from "@/src/lib/deployment-profile";
import { Lockup } from "@/components/layout/logo";

/**
 * Product chrome — shown on login, signup, onboarding, and other public/auth
 * pages of the dashboard.
 *
 * ADR-0006 / deploy#1033: pricing and the marketing surface moved to the
 * SaaS-only www-svc. External links are driven by the deployment-profile
 * resolver (dashboard#924 / PRD dashboard#920): when `marketingUrl` is null
 * (self-hosted), no off-cluster marketing links are rendered. When set (SaaS),
 * the pricing link points at `${marketingUrl}/pricing`.
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
  const { marketingUrl } = getDeploymentProfile();

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
          <Link
            href="/docs"
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
