'use client';

import { useState, useEffect } from 'react';
import { useAuthorize } from '@/src/lib/auth/use-authorize';
import { CheckoutButton } from '@/app/(public)/pricing/checkout-button';
import type { BillingStatus } from '@/src/lib/k8s/types';

interface BillingPageProps {
  billingStatus?: BillingStatus;
  tierName?: string;
}

/**
 * Billing status badge — coloured by state.
 */
function BillingStatusBadge({ status }: { status?: BillingStatus['status'] }) {
  if (!status) {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
        No billing
      </span>
    );
  }

  const colors: Record<NonNullable<BillingStatus['status']>, string> = {
    trialing: 'bg-link text-link',
    active: 'bg-highlight text-highlight',
    past_due: 'bg-alt text-alt',
    cancelled: 'bg-destructive text-destructive',
    incomplete: 'bg-alt text-alt',
    incomplete_expired: 'bg-destructive text-destructive',
  };

  const labels: Record<NonNullable<BillingStatus['status']>, string> = {
    trialing: 'Trial',
    active: 'Active',
    past_due: 'Past due',
    cancelled: 'Cancelled',
    incomplete: 'Incomplete',
    incomplete_expired: 'Expired',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status]}`}
    >
      {labels[status]}
    </span>
  );
}

/**
 * Dismissible banner component using sessionStorage to track dismissed state.
 */
function DismissibleBanner({
  id,
  children,
  variant,
}: {
  id: string;
  children: React.ReactNode;
  variant: 'amber' | 'blue';
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof sessionStorage !== 'undefined') {
      setDismissed(sessionStorage.getItem(`banner-dismissed-${id}`) === '1');
    }
  }, [id]);

  if (dismissed) return null;

  const colors =
    variant === 'amber'
      ? 'bg-alt/10 border-alt/40 text-alt'
      : 'bg-link/10 border-link/40 text-link';

  return (
    <div className={`border rounded-lg p-4 mb-4 flex items-start justify-between ${colors}`}>
      <div className="flex-1">{children}</div>
      <button
        onClick={() => {
          if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(`banner-dismissed-${id}`, '1');
          }
          setDismissed(true);
        }}
        className="ml-4 text-current opacity-60 hover:opacity-100 text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Billing settings page.
 *
 * Shows:
 * - Current plan name and tier
 * - Billing status badge (trialing, active, past_due, cancelled)
 * - Trial end date when trialing
 * - Billing period end when active
 * - Amber past-due banner with portal link when status = past_due
 * - Blue trial-ending-soon banner with days remaining when trialEndsSoon = true
 * - "Manage billing" button (tenant_admin only, via useAuthorize hide-on-loading pattern)
 *
 * This component receives billing status as props from a parent server component
 * or layout that fetches the Tenant CR. In the MVP, the billing status fields
 * may be absent (null) for tenants that have never started a checkout.
 */
export default function BillingSettingsPage({
  billingStatus,
  tierName = 'Solo (Free)',
}: BillingPageProps) {
  // Hide the "Manage billing" button for non-admin users.
  const { allowed: canManageBilling, loading: authLoading } = useAuthorize(
    '/gibson.admin.v1.TenantAdminService/CountSecrets',
  );

  const daysRemaining =
    billingStatus?.trialEnd
      ? Math.max(
          0,
          Math.ceil(
            (new Date(billingStatus.trialEnd).getTime() - Date.now()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-2">Billing</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Manage your Gibson subscription and payment details.
      </p>

      {/* Past-due banner */}
      {billingStatus?.status === 'past_due' && (
        <DismissibleBanner id="past-due" variant="amber">
          <p className="text-sm font-medium">
            Your payment is past due.{' '}
            <span className="font-normal">
              Update your payment method to avoid service interruption. After 7
              days, paid features will be restricted.
            </span>
          </p>
        </DismissibleBanner>
      )}

      {/* Trial-ending-soon banner */}
      {billingStatus?.trialEndsSoon && (
        <DismissibleBanner id="trial-ending" variant="blue">
          <p className="text-sm font-medium">
            Your trial ends in {daysRemaining ?? 'a few'} days.{' '}
            <span className="font-normal">
              Make sure your payment method is up to date to continue after the
              trial.
            </span>
          </p>
        </DismissibleBanner>
      )}

      {/* Billing status card */}
      <div className="bg-card border rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Current plan</p>
            <p className="text-lg font-semibold">{tierName}</p>
          </div>
          <BillingStatusBadge status={billingStatus?.status} />
        </div>

        {billingStatus?.status === 'trialing' && billingStatus.trialEnd && (
          <div className="border-t pt-4">
            <p className="text-xs text-muted-foreground">Trial ends</p>
            <p className="text-sm font-medium">
              {new Date(billingStatus.trialEnd).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
          </div>
        )}

        {billingStatus?.status === 'active' && billingStatus.currentPeriodEnd && (
          <div className="border-t pt-4">
            <p className="text-xs text-muted-foreground">Next billing date</p>
            <p className="text-sm font-medium">
              {new Date(billingStatus.currentPeriodEnd).toLocaleDateString(
                'en-US',
                {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                },
              )}
            </p>
          </div>
        )}
      </div>

      {/* Manage billing button — hidden while loading or when denied */}
      {!authLoading && canManageBilling && (
        <div className="max-w-xs">
          <CheckoutButton
            tier="squad"
            label="Manage billing"
            variant="outline"
            portalMode={true}
          />
        </div>
      )}

      {/* No billing info placeholder */}
      {!billingStatus && (
        <p className="text-sm text-muted-foreground">
          No active subscription. Visit the{' '}
          <a href="/pricing" className="underline">
            pricing page
          </a>{' '}
          to start a trial.
        </p>
      )}
    </div>
  );
}
