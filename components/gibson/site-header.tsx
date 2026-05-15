import Link from "next/link";
import { getServerSession } from "@/src/lib/auth";

export async function SiteHeader() {
  const session = await getServerSession();

  return (
    <header className="border-b border-border bg-background/80 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link
          href="/"
          className="text-zd-glow font-mono text-base font-bold sm:text-lg"
          aria-label="Zero Day AI — home"
        >
          <span className="text-highlight">[</span>
          <span className="text-alt">gibson</span>
          <span className="text-highlight">@</span>
          <span className="text-highlight">zero-day</span>
          <span className="text-alt">]: </span>
          <span className="text-highlight"> ~ </span>
          <span className="text-alt">$</span>
          <span className="zd-cursor ml-1" aria-hidden="true" />
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
        </nav>
      </div>
    </header>
  );
}
