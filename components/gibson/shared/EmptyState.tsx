"use client";

/**
 * Shared empty-state card for list pages. Every list page across the
 * authenticated dashboard should reach for this primitive rather than
 * rolling its own, see CLAUDE.md "Design system" for the rationale.
 *
 * Pure presentation: the parent owns data fetching and decides when the
 * list is empty. The component renders an icon, a title, an optional
 * description paragraph, and up to two CTA slots (primary + secondary).
 *
 * dashboard#143/#146.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  /** Primary call-to-action (e.g. "Deploy your first agent"). */
  primaryCta?: ReactNode;
  /** Secondary action (e.g. "Read the docs"). */
  secondaryCta?: ReactNode;
  /** Optional className passed through to the outer Card. */
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  primaryCta,
  secondaryCta,
  className,
}: EmptyStateProps) {
  return (
    <Card
      className={cn("border-dashed bg-card/40", className)}
      data-testid="empty-state"
    >
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        {Icon ? (
          <Icon
            className="size-10 text-muted-foreground"
            aria-hidden="true"
            data-testid="empty-state-icon"
          />
        ) : null}
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground" data-testid="empty-state-title">
            {title}
          </h3>
          {description ? (
            <p
              className="max-w-prose text-sm text-muted-foreground"
              data-testid="empty-state-description"
            >
              {description}
            </p>
          ) : null}
        </div>
        {primaryCta || secondaryCta ? (
          <div
            className="mt-2 flex flex-col items-center gap-2 sm:flex-row"
            data-testid="empty-state-actions"
          >
            {primaryCta}
            {secondaryCta}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
