/**
 * Secrets page empty-state variants.
 *
 * Task 10 (secrets list page) imports this component and renders the
 * appropriate variant based on tenant provisioning state.
 *
 * Three variants:
 *
 *   1. `unavailable`, The secrets broker could not be reached (genuine outage
 *                      / daemon error). This is NOT a "you must configure a
 *                      backend" dead-end — Hosted is always active — so there
 *                      is no configure-backend CTA that would trap the user.
 *                      Shows an error state; the fix is to retry.
 *
 *   2. `onboarding` , Hosted broker active (default for every tenant) with
 *                      zero secrets.
 *                      CTA: Add your first secret
 *                      Secondary: Or skip and register a plugin
 *
 *   3. `no-secrets` , BYO Vault active with zero secrets.
 *                      CTA: Add your first secret
 *
 * Usage (in secrets list page):
 *
 *   import { SecretsEmptyState } from "@/src/components/secrets/EmptyState";
 *
 *   // broker unreachable:
 *   <SecretsEmptyState variant="unavailable" />
 *
 *   // Hosted broker ready, zero secrets:
 *   <SecretsEmptyState variant="onboarding" onAddSecret={openAddModal} />
 *
 *   // BYO Vault ready, zero secrets:
 *   <SecretsEmptyState variant="no-secrets" onAddSecret={openAddModal} />
 */

import Link from "next/link";
import { KeyRoundIcon, PlugIcon, TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

// ---------------------------------------------------------------------------
// Variant: broker unavailable (genuine outage / daemon error)
// ---------------------------------------------------------------------------

function SecretsEmptyStateUnavailable() {
  return (
    <Empty data-testid="secrets-backend-unavailable">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <TriangleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>Secrets backend unavailable</EmptyTitle>
        <EmptyDescription>
          We couldn&apos;t reach your secrets backend. This is usually a
          temporary connectivity issue with the platform, not a configuration
          problem. Try again in a moment.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/pages/settings/secrets">Retry</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Variant: onboarding (Gibson-hosted Vault ready, zero secrets)
// ---------------------------------------------------------------------------

interface SecretsEmptyStateOnboardingProps {
  /** Called when the user clicks "Add your first secret". */
  onAddSecret?: () => void;
}

function SecretsEmptyStateOnboarding({
  onAddSecret,
}: SecretsEmptyStateOnboardingProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon />
        </EmptyMedia>
        {/* The heading text is specified in R7.2 verbatim. */}
        <EmptyTitle>Your secrets backend is ready (Gibson-hosted Vault)</EmptyTitle>
        <EmptyDescription>
          Your tenant has a dedicated Vault namespace provisioned and ready.
          Add an API key or other credential to get started, or skip ahead and
          register a plugin first.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center gap-2 flex-wrap">
        {/* Primary CTA */}
        {onAddSecret ? (
          <Button size="sm" onClick={onAddSecret}>
            Add your first secret
          </Button>
        ) : (
          <Button asChild size="sm">
            <Link href="/dashboard/pages/settings/secrets/new">
              Add your first secret
            </Link>
          </Button>
        )}
        {/* Secondary link: plugin wizard, requirements say "link to plugin wizard" */}
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/deploy?type=plugin">
            <PlugIcon className="size-3.5 mr-1.5" aria-hidden="true" />
            Or skip and register a plugin
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Variant: no secrets (BYO broker / general case)
// ---------------------------------------------------------------------------

interface SecretsEmptyStateNoSecretsProps {
  onAddSecret?: () => void;
}

function SecretsEmptyStateNoSecrets({
  onAddSecret,
}: SecretsEmptyStateNoSecretsProps) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon />
        </EmptyMedia>
        <EmptyTitle>No secrets yet</EmptyTitle>
        <EmptyDescription>
          Add credentials, API keys, and other secrets your plugins can resolve
          at mission time.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {onAddSecret ? (
          <Button size="sm" onClick={onAddSecret}>
            Add your first secret
          </Button>
        ) : (
          <Button asChild size="sm">
            <Link href="/dashboard/pages/settings/secrets/new">
              Add your first secret
            </Link>
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Convenience union component, delegates to the right variant
// ---------------------------------------------------------------------------

type SecretsEmptyStateVariant = "unavailable" | "onboarding" | "no-secrets";

interface SecretsEmptyStateProps {
  variant: SecretsEmptyStateVariant;
  onAddSecret?: () => void;
}

/**
 * Top-level empty-state dispatcher.  Task 10 can use this single import
 * rather than importing the three variant components individually.
 *
 * @example
 *   <SecretsEmptyState variant="onboarding" onAddSecret={openModal} />
 */
export function SecretsEmptyState({ variant, onAddSecret }: SecretsEmptyStateProps) {
  switch (variant) {
    case "unavailable":
      return <SecretsEmptyStateUnavailable />;
    case "onboarding":
      return <SecretsEmptyStateOnboarding onAddSecret={onAddSecret} />;
    case "no-secrets":
      return <SecretsEmptyStateNoSecrets onAddSecret={onAddSecret} />;
  }
}
