"use client";

/**
 * Shared list-page layout wrapper. Standardises the title + description +
 * primary-CTA + optional filter row + table-area pattern that every list
 * page in the authenticated dashboard uses.
 *
 * Use this as the outermost layout for any list page (agents, tools,
 * plugins, missions, findings, teams, users, etc.). The component does
 * not manage data, empty states, or pagination, that's the parent's
 * responsibility. It just wraps children in consistent chrome.
 *
 * dashboard#143/#146.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface ListPageShellProps {
  /** Page title shown in the H1. */
  title: string;
  /** Optional one-line description below the title. */
  description?: ReactNode;
  /** Primary CTA (e.g. AuthGatedButton for Deploy). Rendered top-right. */
  primaryCta?: ReactNode;
  /** Optional filter / search row below the header. */
  filters?: ReactNode;
  /** The main content slot, usually a table, grid, or empty state. */
  children: ReactNode;
  /** Optional className passed through to the outer wrapper. */
  className?: string;
}

export function ListPageShell({
  title,
  description,
  primaryCta,
  filters,
  children,
  className,
}: ListPageShellProps) {
  return (
    <div
      className={cn("flex flex-col gap-6 p-6", className)}
      data-testid="list-page-shell"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-foreground" data-testid="list-page-title">
            {title}
          </h1>
          {description ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid="list-page-description"
            >
              {description}
            </p>
          ) : null}
        </div>
        {primaryCta ? (
          <div className="shrink-0" data-testid="list-page-primary-cta">
            {primaryCta}
          </div>
        ) : null}
      </div>
      {filters ? (
        <div data-testid="list-page-filters">{filters}</div>
      ) : null}
      <div data-testid="list-page-content">{children}</div>
    </div>
  );
}
