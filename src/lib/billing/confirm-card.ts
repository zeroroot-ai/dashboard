/**
 * confirmCardSetup — client-side card confirmation for the inline, single-page
 * card-first signup (dashboard#785).
 *
 * Phase 1 (`signupAction`) created the Stripe customer + a SetupIntent server-
 * side and handed back its client secret. This helper confirms that SetupIntent
 * against the mounted deferred Payment Element (attaching the card; 3DS/SCA
 * inline via redirect: 'if_required') and returns the resulting payment method
 * id. Phase 2 (`completeSignup`) then creates the trialing subscription +
 * account server-side with that payment method.
 *
 * Extracted from the React component so the branchy result handling is unit-
 * testable without a browser. The component passes the real `stripe`/`elements`;
 * tests pass fakes.
 */

// Minimal structural type so this module does not pull the heavy
// @stripe/stripe-js types into call sites that only need this shape.
export interface ConfirmCardStripe {
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

export interface ConfirmCardSetupParams {
  stripe: ConfirmCardStripe;
  elements: unknown;
  /** SetupIntent client secret returned by phase-1 `signupAction`. */
  clientSecret: string;
  /**
   * Absolute URL Stripe redirects back to IF a redirect-based method is used.
   * Cards confirm inline (no redirect), but Stripe requires this to be present.
   */
  returnUrl: string;
}

export type ConfirmCardSetupResult =
  | { ok: true; paymentMethodId: string }
  | { ok: false; error: string };

function paymentMethodId(
  pm: string | { id: string } | null | undefined,
): string | null {
  if (!pm) return null;
  return typeof pm === 'string' ? pm : pm.id;
}

export async function confirmCardSetup(
  params: ConfirmCardSetupParams,
): Promise<ConfirmCardSetupResult> {
  let error: { message?: string } | undefined;
  let setupIntent:
    | { status?: string; payment_method?: string | { id: string } | null }
    | undefined;
  try {
    ({ error, setupIntent } = await params.stripe.confirmSetup({
      elements: params.elements,
      clientSecret: params.clientSecret,
      confirmParams: { return_url: params.returnUrl },
      redirect: 'if_required',
    }));
  } catch (e) {
    // Stripe.js rejects (rather than resolving with {error}) on integration
    // errors. Surface the real message instead of a generic "Something went
    // wrong" so the cause is visible.
    return { ok: false, error: e instanceof Error ? e.message : 'Card confirmation failed.' };
  }

  if (error) {
    // Card declined / validation / SCA failure — the user can correct and
    // resubmit on the same SetupIntent.
    return { ok: false, error: error.message ?? 'Card could not be confirmed.' };
  }
  if (setupIntent?.status !== 'succeeded') {
    return { ok: false, error: 'Card confirmation did not complete. Please try again.' };
  }
  const pmId = paymentMethodId(setupIntent.payment_method);
  if (!pmId) {
    return { ok: false, error: 'No payment method was returned.' };
  }
  return { ok: true, paymentMethodId: pmId };
}
