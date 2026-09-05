"use client";

/**
 * CompleteSignupForm — the post-verification screen.
 *
 * It collects the password and, on the paid profile, the card. Both live here
 * rather than on /signup because neither may exist for an address nobody has
 * proven they control: a password collected earlier would have to be held
 * across the mail round-trip, and a card field needs a SetupIntent, which needs
 * a customer, which is a billing object.
 *
 * The Stripe customer and SetupIntent are created by `startSignupPayment` when
 * this component mounts — that is, strictly after redemption. The client never
 * sees the completion session token; it lives in an httpOnly cookie and the
 * Server Actions read it from there.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loadStripe, type Appearance, type Stripe, type StripeElements } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { toast } from "sonner";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { completeSignup, startSignupPayment } from "@/app/actions/signup";
import {
  confirmCardSetup,
  type ConfirmCardStripe,
} from "@/src/lib/billing/confirm-card";
import {
  isServerActionDeploymentSkew,
  reloadForDeploymentSkew,
} from "@/src/lib/server-action-skew";
import type { PasswordPolicy } from "@/src/lib/zitadel/password-policy-cache";
import type { VerifiedSignupDisplay } from "@/src/lib/signup/verified-session";
import { PasswordStrengthMeter } from "../password-strength-meter";
import { buildStripeAppearance } from "../stripe-appearance";
import { ProvisioningPanel } from "../provisioning-panel";
import {
  completeSignupInputSchema,
  type CompleteSignupFormInput,
} from "../types";

interface CompleteSignupFormProps {
  /** Display-only view of the verified session. Carries NO completion token. */
  verified: VerifiedSignupDisplay;
  passwordPolicy: PasswordPolicy;
  publishableKey: string;
  billingEnabled: boolean;
}

/** Timeout codes are non-destructive: the account and workspace both exist. */
function isNonFatalTimeout(code: string): boolean {
  return code === "PROVISIONING_TIMEOUT" || code === "MEMBERSHIP_TIMEOUT";
}

export function CompleteSignupForm(props: CompleteSignupFormProps) {
  const paidFlow = props.billingEnabled && props.publishableKey !== "";

  // The SetupIntent client secret, fetched on mount via a Server Action. Null
  // until it arrives — and it can only arrive because the session cookie exists,
  // which is what makes this the first moment a billing object may be created.
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<Appearance>({ theme: "night" });

  useEffect(() => {
    setAppearance(buildStripeAppearance());
  }, []);

  useEffect(() => {
    if (!paidFlow) return;
    let cancelled = false;
    void (async () => {
      const result = await startSignupPayment();
      if (cancelled) return;
      if (result.ok && "phase" in result && result.phase === "card") {
        setClientSecret(result.cardClientSecret);
      } else if (!result.ok) {
        setPaymentError(result.userMessage);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [paidFlow]);

  const [stripePromise] = useState(() =>
    paidFlow ? loadStripe(props.publishableKey) : null,
  );

  if (!paidFlow) {
    // Card-free profile: never load Stripe, never mount <Elements>. Calling the
    // Stripe hooks without a provider throws in this version of the library.
    return <CompleteSignupFormInner {...props} stripe={null} elements={null} />;
  }

  if (paymentError) {
    return (
      <CompleteShell verified={props.verified}>
        <p className="text-sm text-destructive" role="alert">
          {paymentError}
        </p>
        <p className="text-sm text-muted-foreground">
          Nothing has been created. Reload this page to try again.
        </p>
      </CompleteShell>
    );
  }

  if (!clientSecret || !stripePromise) {
    return (
      <CompleteShell verified={props.verified}>
        <p className="text-sm text-muted-foreground" aria-busy="true">
          Preparing your payment details…
        </p>
      </CompleteShell>
    );
  }

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
      <CompleteSignupFormWithStripe {...props} clientSecret={clientSecret} />
    </Elements>
  );
}

/** Bridge that reads the Stripe hooks. Rendered ONLY inside <Elements>. */
function CompleteSignupFormWithStripe(
  props: CompleteSignupFormProps & { clientSecret: string },
) {
  const stripe = useStripe();
  const elements = useElements();
  return <CompleteSignupFormInner {...props} stripe={stripe} elements={elements} />;
}

/** Shared chrome so the loading, error and form states look like one screen. */
function CompleteShell({
  verified,
  children,
}: {
  verified: VerifiedSignupDisplay;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">
            Finish setting up {verified.workspaceName}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Verified as{" "}
            <span className="font-medium text-foreground">{verified.email}</span>.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
        <CardFooter className="flex justify-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href="/login"
              className="underline underline-offset-4 hover:no-underline font-medium"
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}

function CompleteSignupFormInner({
  verified,
  passwordPolicy,
  billingEnabled,
  publishableKey,
  clientSecret,
  stripe,
  elements,
}: CompleteSignupFormProps & {
  clientSecret?: string;
  stripe: Stripe | null;
  elements: StripeElements | null;
}) {
  const paidFlow = billingEnabled && publishableKey !== "";

  const [showPassword, setShowPassword] = useState(false);
  const [cardComplete, setCardComplete] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [redirectOnSuccess, setRedirectOnSuccess] = useState("");
  // Set only on a non-fatal PROVISIONING_TIMEOUT result (dashboard#967):
  // lets the panel keep polling with the live-readiness fallback so the
  // holding state auto-resolves when the operator finishes the saga.
  const [timeoutTenantSlug, setTimeoutTenantSlug] = useState<
    string | undefined
  >(undefined);

  const passwordRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<CompleteSignupFormInput>({
    resolver: zodResolver(completeSignupInputSchema),
    defaultValues: { password: "", passwordConfirm: "" },
  });
  const passwordValue = form.watch("password");

  const onSubmit = useCallback(
    async (data: CompleteSignupFormInput) => {
      let paymentMethodId: string | undefined;

      if (paidFlow) {
        if (!stripe || !elements || !clientSecret) {
          setCardError("Payment form is still loading. Try again in a moment.");
          return;
        }
        setCardError(null);
        const { error: submitErr } = await elements.submit();
        if (submitErr) {
          setCardError(submitErr.message ?? "Please check your card details.");
          return;
        }
        const confirmed = await confirmCardSetup({
          stripe: stripe as unknown as ConfirmCardStripe,
          elements,
          clientSecret,
          // Cards confirm inline, but Stripe requires a return_url whenever
          // redirect-capable methods are offered.
          returnUrl: `${window.location.origin}/signup/complete`,
        });
        if (!confirmed.ok) {
          setCardError(confirmed.error);
          toast.error(confirmed.error);
          return;
        }
        paymentMethodId = confirmed.paymentMethodId;
      }

      setProvisioning(true);
      try {
        const result = await completeSignup({
          password: data.password,
          paymentMethodId,
        });
        if (result.ok && "redirect" in result) {
          setRedirectOnSuccess(result.redirect);
          return;
        }
        if (!result.ok) {
          if (isNonFatalTimeout(result.code)) {
            // The account and workspace exist and are still provisioning. Keep
            // the panel up rather than inviting a retry that cannot work. The
            // slug arms the panel's live-readiness fallback poll so the
            // holding state auto-resolves once the workspace is Ready
            // (dashboard#967).
            setTimeoutTenantSlug(result.tenantSlug);
            return;
          }
          setProvisioning(false);
          toast.error(result.userMessage);
          if (result.fieldErrors?.password) {
            form.setError("password", {
              type: "server",
              message: result.fieldErrors.password,
            });
            passwordRef.current?.focus();
          }
        }
      } catch (err) {
        setProvisioning(false);
        console.error("[signup] completion action threw", {
          err,
          message: err instanceof Error ? err.message : String(err),
        });
        if (isServerActionDeploymentSkew(err)) {
          if (reloadForDeploymentSkew()) {
            toast.error("The app was updated, reloading…");
          } else {
            toast.error(
              "The app was updated. Please refresh the page and try again.",
            );
          }
          return;
        }
        toast.error("Something went wrong on our end. Please try again.");
      }
    },
    [paidFlow, stripe, elements, clientSecret, form],
  );

  if (provisioning) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-6 px-4 py-12">
        <ProvisioningPanel
          attemptId={verified.attemptId}
          redirectOnSuccess={redirectOnSuccess}
          tenantSlug={timeoutTenantSlug}
          onRetry={() => setProvisioning(false)}
        />
      </div>
    );
  }

  const isDisabled = form.formState.isSubmitting;

  return (
    <CompleteShell verified={verified}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      {...field}
                      ref={(el) => {
                        field.ref(el);
                        passwordRef.current = el;
                      }}
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 12 characters"
                      autoComplete="new-password"
                      disabled={isDisabled}
                      aria-required="true"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      tabIndex={isDisabled ? -1 : undefined}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </FormControl>
                <PasswordStrengthMeter
                  password={passwordValue}
                  policy={passwordPolicy}
                />
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="passwordConfirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm password</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type={showPassword ? "text" : "password"}
                    placeholder="Re-enter your password"
                    autoComplete="new-password"
                    disabled={isDisabled}
                    aria-required="true"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {paidFlow ? (
            <div className="space-y-2">
              <FormLabel>Payment method</FormLabel>
              <div className="rounded-md border border-border bg-background p-3">
                <PaymentElement
                  options={{
                    layout: { type: "accordion", defaultCollapsed: false },
                  }}
                  onChange={(e) => {
                    setCardComplete(e.complete);
                    if (e.complete) setCardError(null);
                  }}
                />
              </div>
              {cardError ? (
                <p className="text-xs text-destructive" role="alert" aria-live="polite">
                  {cardError}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Start your free trial. Your card won&apos;t be charged until it
                ends. Cancel anytime.
              </p>
            </div>
          ) : null}

          <Button
            type="submit"
            className="w-full"
            disabled={isDisabled || (paidFlow && !cardComplete)}
            aria-busy={isDisabled}
          >
            {isDisabled ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </Form>
    </CompleteShell>
  );
}
