import Link from "next/link";
import { getServerSession } from "@/src/lib/auth";

/**
 * Shared public-facing header. Used by the landing page and every (public)
 * route (signup, login, pricing, forgot-password, …) so marketing + auth
 * surfaces stay visually consistent.
 *
 * Server component — reads the session directly so we can show the right
 * CTA (dashboard vs. sign in) without a client-side round-trip.
 */
export async function SiteHeader() {
  const session = await getServerSession();

  return (
    <header className="border-b border-green-500/25">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="font-mono text-lg font-bold text-green-300">
          Zero Day AI
        </Link>
        <div className="flex items-center gap-6 font-mono text-sm">
          <Link
            href="/docs"
            className="text-green-300/70 hover:text-green-300"
          >
            docs
          </Link>
          <Link
            href="/pricing"
            className="text-green-300/70 hover:text-green-300"
          >
            pricing
          </Link>
          {session?.user ? (
            <Link
              href="/dashboard"
              className="text-green-300/70 hover:text-green-300"
            >
              dashboard
            </Link>
          ) : (
            <Link
              href="/login"
              className="text-green-300/70 hover:text-green-300"
            >
              sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
