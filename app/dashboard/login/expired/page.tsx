import React from "react";
import Link from "next/link";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resolveUserFacingError } from "@/src/lib/errors/user-facing";

interface PageProps {
  searchParams: Promise<{ callbackUrl?: string }>;
}

/**
 * Session expired page — pure display. Shown when the Better Auth session
 * cookie has expired and the user is redirected out of a protected route.
 *
 * Preserves the original `callbackUrl` query-string parameter so that after
 * signing back in the user is returned to the page they were trying to visit.
 * The callbackUrl is validated to be a same-origin relative path before use
 * to prevent open-redirect attacks.
 *
 * This page does not require a session; it may be rendered for a completely
 * unauthenticated visitor who was previously signed in.
 */
export default async function ExpiredPage({ searchParams }: PageProps) {
  const { callbackUrl } = await searchParams;

  // Restrict to same-origin relative paths only.
  const safeCallback =
    callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : undefined;

  const signInHref = safeCallback
    ? `/login?callbackUrl=${encodeURIComponent(safeCallback)}`
    : "/login";

  const error = resolveUserFacingError("SESSION_EXPIRED");

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Card
        role="alert"
        aria-label={error.title}
        className="w-full max-w-md"
      >
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl font-semibold leading-none">{error.title}</h1>
          </CardTitle>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm leading-relaxed">
            {error.description}
          </p>

          <Button
            asChild
            className="w-fit focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Link href={signInHref}>Sign in</Link>
          </Button>
        </CardContent>

        <CardFooter>
          <Link
            href="/login"
            className="text-muted-foreground text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          >
            Return to sign in
          </Link>
        </CardFooter>
      </Card>
    </main>
  );
}
