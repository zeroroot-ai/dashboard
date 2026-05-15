import Link from "next/link";
import { getServerSession } from "@/src/lib/auth";

/**
 * Shared public-facing header. Used by the landing page and every (public)
 * route (signup, login, pricing, forgot-password, …) so marketing + auth
 * surfaces stay visually consistent.
 *
 * Visual style imported from the holding-page Hugo site at
 * https://www.zero-day.ai/ (dashboard#48): terminal-prompt logo with the
 * `[gibson@zero-day]: ~$ ▮` layout, the glow text-shadow, and the
 * blinking cursor. Color tokens from dashboard#47.
 *
 * Server component — reads the session directly so we can show the right
 * CTA (dashboard vs. sign in) without a client-side round-trip.
 */
export async function SiteHeader() {
  const session = await getServerSession();

  return (
    <header className="border-b border-[var(--color-zd-border)] bg-[var(--color-zd-bg)]/80 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link
          href="/"
          className="text-zd-glow font-mono text-base font-bold sm:text-lg"
          aria-label="Zero Day AI — home"
        >
          <span className="text-[var(--color-zd-highlight)]">[</span>
          <span className="text-[var(--color-zd-alt)]">gibson</span>
          <span className="text-[var(--color-zd-highlight)]">@</span>
          <span className="text-[var(--color-zd-highlight)]">zero-day</span>
          <span className="text-[var(--color-zd-alt)]">]: </span>
          <span className="text-[var(--color-zd-highlight)]"> ~ </span>
          <span className="text-[var(--color-zd-alt)]">$</span>
          <span className="zd-cursor ml-1" aria-hidden="true" />
        </Link>
        <nav className="flex items-center gap-6 font-mono text-sm" aria-label="Primary">
          <Link
            href="/docs"
            className="text-[var(--color-zd-fg)] transition-colors hover:text-[var(--color-zd-link)]"
          >
            docs
          </Link>
          <Link
            href="/pricing"
            className="text-[var(--color-zd-fg)] transition-colors hover:text-[var(--color-zd-link)]"
          >
            pricing
          </Link>
          {session?.user ? (
            <Link
              href="/dashboard"
              className="text-[var(--color-zd-fg)] transition-colors hover:text-[var(--color-zd-link)]"
            >
              dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-[var(--color-zd-fg)] transition-colors hover:text-[var(--color-zd-link)]"
            >
              sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
