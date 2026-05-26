import Link from "next/link";
import { getServerSession } from "@/src/lib/auth";
import { Lockup } from "@/components/layout/logo";
import { ModeToggle } from "@/components/layout/header/mode-toggle";

/**
 * Public chrome — landing, pricing, docs.
 *
 * Brand lockup: full BrainCRT mark (with monitor stand, "the actual terminal")
 * sitting next to the "zeroroot.ai" wordmark. Same treatment as the square
 * 75mm sticker in the brand guide. Mark uses var(--primary); wordmark uses
 * var(--foreground); ".ai" dims to var(--muted-foreground).
 */
export async function SiteHeader() {
  const session = await getServerSession();

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between gap-4 px-4">
        <Link
          href="/"
          aria-label="Zero Day AI — home"
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
          <Link
            href="/pricing"
            className="text-foreground transition-colors hover:text-link"
          >
            pricing
          </Link>
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
          <ModeToggle />
        </nav>
      </div>
    </header>
  );
}
