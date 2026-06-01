"use client";

/**
 * AuthGatedButton — render a primary CTA with deterministic visibility.
 *
 * Use when an action should always be discoverable, but is sometimes
 * disallowed for the current user. Distinct from the `useAuthorize` +
 * `return null` pattern, which hides the affordance entirely. Use that
 * pattern for actions the user shouldn't even know exist (admin
 * scaffolding, internal tooling). Use this when the user benefits from
 * seeing the affordance and learning why they can't take it.
 *
 * Three render states, driven by the `state` prop:
 *
 *   "loading"  → <Skeleton aria-busy /> placeholder; non-interactive.
 *   "denied"   → disabled <Button> wrapped in a Tooltip carrying
 *                `disabledTooltip` copy. The user sees the action and
 *                learns the permission they need.
 *   "allowed"  → full clickable <Button> rendering the caller's children.
 *
 * The component is intentionally agnostic about how state is computed —
 * callers derive `state` from `useAuthorize` (async, returns
 * `{ allowed, loading }`) against the RPC the gated action invokes. See the
 * Frontend authz section in CLAUDE.md for guidance on when to use this
 * vs. the hide-on-loading pattern.
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type AuthGateState = "allowed" | "denied" | "loading";

export type AuthGatedButtonProps = React.ComponentProps<typeof Button> & {
  /** Computed visibility state. */
  state: AuthGateState;
  /** Tooltip copy shown when state="denied". Customer terminology only. */
  disabledTooltip: string;
  /**
   * Optional skeleton dimension override. Defaults match a `size="sm"`
   * Button so layout doesn't shift between loading and resolved states.
   */
  loadingSkeletonClassName?: string;
};

const DEFAULT_SKELETON_CLASS = "h-8 w-28 rounded-md";

export function AuthGatedButton({
  state,
  disabledTooltip,
  loadingSkeletonClassName,
  children,
  className,
  asChild,
  disabled,
  ...buttonProps
}: AuthGatedButtonProps) {
  if (state === "loading") {
    return (
      <Skeleton
        className={loadingSkeletonClassName ?? DEFAULT_SKELETON_CLASS}
        aria-busy="true"
        aria-label="Loading permission check"
        data-testid="auth-gated-button-loading"
      />
    );
  }

  if (state === "denied") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            {/* The disabled button must remain in the DOM, focusable for
                keyboard users, and pointer-event-receiving so the
                tooltip can open on hover. asChild is intentionally not
                forwarded — we always render the real <Button> here so
                disabled + aria semantics are correct. */}
            <span
              tabIndex={0}
              role="button"
              aria-disabled="true"
              data-testid="auth-gated-button-denied"
              className="inline-flex"
            >
              <Button
                {...buttonProps}
                className={className}
                disabled
                tabIndex={-1}
                aria-hidden="true"
              >
                {children}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{disabledTooltip}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Button
      {...buttonProps}
      className={className}
      asChild={asChild}
      disabled={disabled}
      data-testid="auth-gated-button-allowed"
    >
      {children}
    </Button>
  );
}
