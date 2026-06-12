/**
 * confirmCardAndSubscribe — the orchestration behind the in-page Payment
 * Element (card-first signup S2, dashboard#769).
 *
 * Given a Stripe.js instance + the Payment Element's `elements`, it:
 *   1. confirms the SetupIntent (collects + attaches the card; 3DS/SCA is
 *      handled inline by the element — redirect: 'if_required' keeps the flow
 *      on-page for the common case), then
 *   2. creates the trialing subscription server-side with the confirmed
 *      payment method.
 *
 * Extracted from the React component so the branchy result handling is unit-
 * testable without a browser or the Stripe.js iframe. The component passes
 * real `stripe`/`elements`; tests pass fakes.
 */

// Minimal structural types so this module does not depend on the heavy
// @stripe/stripe-js types at the call sites that only need these shapes.
export interface ConfirmCardStripe {
  confirmSetup(args: {
    elements: unknown;
    redirect: 'if_required';
  }): Promise<{
    error?: { message?: string };
    setupIntent?: { status?: string; payment_method?: string | { id: string } | null };
  }>;
}

export interface ConfirmCardParams {
  stripe: ConfirmCardStripe;
  elements: unknown;
  tenantSlug: string;
  tier: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

export type ConfirmCardResult =
  | { ok: true; subscriptionId: string }
  | { ok: false; error: string; retryable: boolean };

function paymentMethodId(
  pm: string | { id: string } | null | undefined,
): string | null {
  if (!pm) return null;
  return typeof pm === 'string' ? pm : pm.id;
}

export async function confirmCardAndSubscribe(
  params: ConfirmCardParams,
): Promise<ConfirmCardResult> {
  const doFetch = params.fetchFn ?? fetch;

  const { error, setupIntent } = await params.stripe.confirmSetup({
    elements: params.elements,
    redirect: 'if_required',
  });

  if (error) {
    // Card declined / validation / SCA failure — the user can correct and
    // resubmit on the same SetupIntent.
    return { ok: false, error: error.message ?? 'Card could not be confirmed.', retryable: true };
  }
  if (setupIntent?.status !== 'succeeded') {
    return {
      ok: false,
      error: 'Card confirmation did not complete. Please try again.',
      retryable: true,
    };
  }
  const pmId = paymentMethodId(setupIntent.payment_method);
  if (!pmId) {
    return { ok: false, error: 'No payment method was returned.', retryable: true };
  }

  let res: Response;
  try {
    res = await doFetch('/api/billing/subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantSlug: params.tenantSlug,
        tier: params.tier,
        paymentMethodId: pmId,
      }),
    });
  } catch {
    return { ok: false, error: 'Network error creating your subscription.', retryable: true };
  }

  if (res.status === 409) {
    // Customer not yet written to the tenant CR status — transient; retry.
    return { ok: false, error: 'Still preparing your workspace — retrying.', retryable: true };
  }
  if (!res.ok) {
    return { ok: false, error: 'We could not start your subscription.', retryable: false };
  }
  const data = (await res.json().catch(() => ({}))) as { subscriptionId?: string };
  if (!data.subscriptionId) {
    return { ok: false, error: 'Subscription response was malformed.', retryable: false };
  }
  return { ok: true, subscriptionId: data.subscriptionId };
}
