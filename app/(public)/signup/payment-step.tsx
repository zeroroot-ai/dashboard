"use client";

/**
 * PaymentStep — in-page card collection for card-first signup
 * (dashboard#769). Renders the Stripe Payment Element bound to a SetupIntent
 * (fetched from /api/billing/setup-intent), and on submit confirms the card +
 * creates the trialing subscription via confirmCardAndSubscribe. No redirect
 * to hosted Checkout; the card form lives inside the signup provisioning flow.
 *
 * The branchy confirm/subscribe orchestration is unit-tested in
 * src/lib/billing/__tests__/confirm-card.test.ts; this component is the thin
 * Stripe.js/React shell, verified end-to-end on staging.
 */

import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { confirmCardAndSubscribe } from "@/src/lib/billing/confirm-card";

// Cache the Stripe.js promise per publishable key. The key arrives at runtime
// (prop from the server component) rather than the build-time NEXT_PUBLIC var,
// because the shared :main image can't bake a per-env (test vs live) key
// (dashboard#783).
let stripePromise: Promise<Stripe | null> | null = null;
let stripePromiseKey: string | null = null;
function getStripe(publishableKey: string): Promise<Stripe | null> {
  if (!stripePromise || stripePromiseKey !== publishableKey) {
    stripePromiseKey = publishableKey;
    stripePromise = publishableKey
      ? loadStripe(publishableKey)
      : Promise.resolve(null);
  }
  return stripePromise;
}

interface PaymentStepProps {
  tenantSlug: string;
  tier: string;
  /** Stripe publishable key, runtime-injected (dashboard#783). */
  publishableKey: string;
  /** Called once the trialing subscription is created. */
  onComplete: () => void;
}

export function PaymentStep({ tenantSlug, tier, publishableKey, onComplete }: PaymentStepProps) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Fetch the SetupIntent client secret, retrying on 409 (the
  // CreateStripeCustomer saga step may not have written the customer yet).
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    async function fetchSecret() {
      while (!cancelled && attempts < 20) {
        attempts += 1;
        try {
          const res = await fetch("/api/billing/setup-intent", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ tenantSlug }),
          });
          if (res.status === 409) {
            await new Promise((r) => setTimeout(r, 3000));
            continue;
          }
          if (!res.ok) {
            if (!cancelled) setFetchError("Could not start payment. Please retry.");
            return;
          }
          const data = (await res.json()) as { clientSecret?: string };
          if (!cancelled && data.clientSecret) setClientSecret(data.clientSecret);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
    void fetchSecret();
    return () => {
      cancelled = true;
    };
  }, [tenantSlug]);

  const stripe = useMemo(() => getStripe(publishableKey), [publishableKey]);

  if (fetchError) {
    return <p className="text-error-text text-sm">{fetchError}</p>;
  }
  if (!clientSecret) {
    return <p className="text-muted-foreground text-sm">Preparing secure payment…</p>;
  }

  return (
    <Elements stripe={stripe} options={{ clientSecret }}>
      <CardForm tenantSlug={tenantSlug} tier={tier} publishableKey={publishableKey} onComplete={onComplete} />
    </Elements>
  );
}

function CardForm({ tenantSlug, tier, onComplete }: PaymentStepProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await confirmCardAndSubscribe({ stripe, elements, tenantSlug, tier });
    if (result.ok) {
      onComplete();
      return;
    }
    setError(result.error);
    setSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {error ? <p className="text-error-text text-sm">{error}</p> : null}
      <Button type="submit" disabled={!stripe || submitting} className="w-full">
        {submitting ? "Confirming…" : "Start 14-day trial"}
      </Button>
      <p className="text-muted-foreground text-xs">
        Your card won&apos;t be charged until the trial ends. Cancel anytime.
      </p>
    </form>
  );
}
