/**
 * confirmCardAndSubscribe — orchestration behind the INLINE, single-page card
 * collection (card-first signup redesign, dashboard#784/#785).
 *
 * The signup form renders a DEFERRED-mode Payment Element (no pre-created
 * SetupIntent), so the caller validates the card client-side with
 * `elements.submit()` BEFORE the account is created. After the account +
 * Stripe customer exist, this function:
 *   1. fetches a SetupIntent client secret for the tenant's customer
 *      (/api/billing/setup-intent, retrying 409 while the CreateStripeCustomer
 *      saga step finishes writing the customer to the Tenant CR status),
 *   2. confirms the SetupIntent against the deferred Elements (attaches the
 *      card; 3DS/SCA inline via redirect: 'if_required'), then
 *   3. creates the trialing subscription with the confirmed payment method.
 *
 * Extracted from the React component so the branchy result handling is unit-
 * testable without a browser. The component passes real `stripe`/`elements`;
 * tests pass fakes.
 */

// Minimal structural types so this module does not pull the heavy
// @stripe/stripe-js types into call sites that only need these shapes.
export interface ConfirmCardStripe {
  // Deferred-intent confirmation: clientSecret comes from the SetupIntent
  // created server-side on submit (mode:'setup' Elements have none of their own).
  confirmSetup(args: {
    elements: unknown;
    clientSecret: string;
    // Required by Stripe whenever the Element offers a redirect-capable method
    // (automatic_payment_methods enables several) — even with redirect:
    // 'if_required'. Omitting it throws an IntegrationError.
    confirmParams: { return_url: string };
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
  /**
   * Absolute URL Stripe redirects back to IF a redirect-based method is used.
   * Cards confirm inline (no redirect), but Stripe requires this to be present.
   */
  returnUrl: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Injectable for tests; defaults to a real 3s sleep between 409 retries. */
  sleepFn?: (ms: number) => Promise<void>;
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

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fetch a SetupIntent client secret for the tenant's customer. Retries on 409
 * (customer not yet written to the Tenant CR status by the CreateStripeCustomer
 * saga step) for up to ~60s.
 */
async function fetchClientSecret(
  doFetch: typeof fetch,
  sleep: (ms: number) => Promise<void>,
  tenantSlug: string,
): Promise<{ clientSecret: string } | { error: string; retryable: boolean }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let res: Response;
    try {
      res = await doFetch('/api/billing/setup-intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantSlug }),
      });
    } catch {
      await sleep(3000);
      continue;
    }
    if (res.status === 409) {
      await sleep(3000);
      continue;
    }
    if (!res.ok) {
      return { error: 'Could not start payment setup. Please try again.', retryable: false };
    }
    const data = (await res.json().catch(() => ({}))) as { clientSecret?: string };
    if (!data.clientSecret) {
      return { error: 'Payment setup response was malformed.', retryable: false };
    }
    return { clientSecret: data.clientSecret };
  }
  return { error: 'Timed out preparing payment. Please retry.', retryable: true };
}

export async function confirmCardAndSubscribe(
  params: ConfirmCardParams,
): Promise<ConfirmCardResult> {
  const doFetch = params.fetchFn ?? fetch;
  const sleep = params.sleepFn ?? defaultSleep;

  const secret = await fetchClientSecret(doFetch, sleep, params.tenantSlug);
  if ('error' in secret) {
    return { ok: false, error: secret.error, retryable: secret.retryable };
  }

  let error: { message?: string } | undefined;
  let setupIntent: { status?: string; payment_method?: string | { id: string } | null } | undefined;
  try {
    ({ error, setupIntent } = await params.stripe.confirmSetup({
      elements: params.elements,
      clientSecret: secret.clientSecret,
      confirmParams: { return_url: params.returnUrl },
      redirect: 'if_required',
    }));
  } catch (e) {
    // Stripe.js rejects (rather than resolving with {error}) on integration
    // errors. Surface the real message instead of bubbling an uncaught throw up
    // to the signup form's generic "Something went wrong" handler.
    const msg = e instanceof Error ? e.message : 'Card confirmation failed.';
    return { ok: false, error: msg, retryable: true };
  }

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
