/**
 * Secrets page empty-state variants.
 *
 * Task 10 (secrets list page) imports this component and renders the
 * appropriate variant based on tenant provisioning state.
 *
 * Three variants per Requirement 1.6 and 7.2:
 *
 *   1. `no-broker`  , Tenant has no broker configured yet.
 *                      CTA: configure broker first → /settings/secrets-backend
 *
 *   2. `onboarding` , Tenant has a configured broker (default: Gibson-hosted
 *                      Vault after signup) but zero secrets.
 *                      Shows the post-signup onboarding message per R7.2:
 *                      "Your secrets backend is ready (Gibson-hosted Vault)"
 *                      CTA: Add your first secret
 *                      Secondary: Or skip and register a plugin
 *
 *   3. `no-secrets` , Tenant has a configured broker but zero secrets and the
 *                      onboarding message has already been dismissed / doesn't
 *                      apply (BYO broker case).
 *                      CTA: Add your first secret
 *
 * Usage (in secrets list page):
 *
 *   import { SecretsEmptyState } from "@/src/components/secrets/EmptyState";
 *
 *   // no broker configured:
 *   <SecretsEmptyState variant="no-broker" />
 *
 *   // new tenant post-signup with Gibson-hosted Vault ready:
 *   <SecretsEmptyState variant="onboarding" onAddSecret={openAddModal} />
 *
 *   // existing tenant with BYO broker and zero secrets:
 *   <SecretsEmptyState variant="no-secrets" onAddSecret={openAddModal} />
 */

import Link from "next/link";
import { DatabaseIcon, KeyRoundIcon, PlugIcon } from "lucide-react";

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
// Variant: no broker configured
// ---------------------------------------------------------------------------

export function SecretsEmptyStateNoBroker() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DatabaseIcon />
        </EmptyMedia>
        <EmptyTitle>No secrets backend configured</EmptyTitle>
        <EmptyDescription>
          You need to configure a secrets backend before adding secrets. Choose
          between Gibson-hosted Vault or bring your own provider.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild size="sm">
          <Link href="/dashboard/pages/settings/secrets-backend">
            Configure secrets backend
          </Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Variant: onboarding (Gibson-hosted Vault ready, zero secrets)
// ---------------------------------------------------------------------------

export interface SecretsEmptyStateOnboardingProps {
  /** Called when the user clicks "Add your first secret". */
  onAddSecret?: () => void;
}

export function SecretsEmptyStateOnboarding({
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

export interface SecretsEmptyStateNoSecretsProps {
  onAddSecret?: () => void;
}

export function SecretsEmptyStateNoSecrets({
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

export type SecretsEmptyStateVariant = "no-broker" | "onboarding" | "no-secrets";

export interface SecretsEmptyStateProps {
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
    case "no-broker":
      return <SecretsEmptyStateNoBroker />;
    case "onboarding":
      return <SecretsEmptyStateOnboarding onAddSecret={onAddSecret} />;
    case "no-secrets":
      return <SecretsEmptyStateNoSecrets onAddSecret={onAddSecret} />;
  }
}
