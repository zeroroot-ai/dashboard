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
import type { UserFacingError } from "@/src/lib/errors/user-facing";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  error: UserFacingError;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Shared error display used by all named error pages (no-workspace, locked,
 * expired, forbidden). Renders:
 *
 * - Card wrapping with role="alert" for screen-reader announcement.
 * - h1 title from error.title.
 * - Description paragraph.
 * - Optional primary action CTA when error.action is present.
 * - Muted "Reference: {correlationId}" footer when correlationId is present.
 * - Always-present "Return to sign in" escape hatch at the bottom.
 *
 * Accessibility: WCAG 2.2 AA, every interactive element carries a
 * focus-visible ring via the Shadcn button primitives; role="alert" on the
 * Card announces the error summary to assistive technology; logical heading
 * hierarchy starts at h1.
 */
export function ErrorDisplay({ error, className }: Props) {
  return (
    <Card
      role="alert"
      aria-label={error.title}
      className={className}
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

        {error.action && (
          <Button asChild className="w-fit focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
            <Link href={error.action.href}>{error.action.label}</Link>
          </Button>
        )}
      </CardContent>

      <CardFooter className="flex flex-col items-start gap-3">
        {error.correlationId && (
          <p className="text-muted-foreground text-xs">
            Reference: <span className="font-mono">{error.correlationId}</span>
          </p>
        )}

        <Link
          href="/login"
          className="text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
        >
          Return to sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
