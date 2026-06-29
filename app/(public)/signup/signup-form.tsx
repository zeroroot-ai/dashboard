"use client";

/**
 * SignupForm, Client Component.
 *
 * Controlled form built with react-hook-form + zodResolver(signupInputSchema).
 * Fields (in DOM order): firstName, lastName, email, password, workspaceName,
 * acceptToS checkbox, acceptPrivacy checkbox.
 *
 * On submit:
 *  1. Disables the form and sets provisioning state.
 *  2. Calls `signupAction(data)` (Server Action).
 *  3. On success → renders `<ProvisioningPanel>`.
 *  4. On failure → displays the userMessage via sonner toast, focuses the
 *     first errored field if `fieldErrors` is present.
 *
 * Shows a `beforeunload` prompt while provisioning to prevent accidental
 * navigation.
 *
 * Branding: uses the dashboard's CSS custom properties from globals.css /
 * themes.css via Shadcn's Card, Input, Label, Checkbox, Button, and Form
 * primitives. Matches `/login` and `/pricing` visual weight.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { loadStripe, type Appearance } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { zodResolver } from "@hookform/resolvers/zod";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { signupAction, completeSignup } from "@/app/actions/signup";
import {
  confirmCardSetup,
  type ConfirmCardStripe,
} from "@/src/lib/billing/confirm-card";
import {
  isServerActionDeploymentSkew,
  reloadForDeploymentSkew,
} from "@/src/lib/server-action-skew";
import type { PasswordPolicy } from "@/src/lib/zitadel/password-policy-cache";
import { isReservedSlug, slugify } from "@/src/lib/signup/slug";
import { useReservedNames } from "@/src/lib/signup/use-reserved-names";
import { useTenantAvailability } from "@/src/lib/signup/use-tenant-availability";
import { ProvisioningPanel } from "./provisioning-panel";
import { signupInputSchema, type SignupInput } from "./types";

// ---------------------------------------------------------------------------
// Password strength meter
// ---------------------------------------------------------------------------

interface PolicyCheck {
  label: string;
  met: boolean;
}

function buildPolicyChecks(
  password: string,
  policy: PasswordPolicy,
): PolicyCheck[] {
  return [
    {
      label: `At least ${policy.minLength} characters`,
      met: password.length >= policy.minLength,
    },
    ...(policy.hasUppercase
      ? [{ label: "One uppercase letter", met: /[A-Z]/.test(password) }]
      : []),
    ...(policy.hasLowercase
      ? [{ label: "One lowercase letter", met: /[a-z]/.test(password) }]
      : []),
    ...(policy.hasNumber
      ? [{ label: "One number", met: /[0-9]/.test(password) }]
      : []),
    ...(policy.hasSymbol
      ? [
          {
            label: "One symbol",
            met: /[^a-zA-Z0-9]/.test(password),
          },
        ]
      : []),
  ];
}

function PasswordStrengthMeter({
  password,
  policy,
}: {
  password: string;
  policy: PasswordPolicy;
}) {
  if (!password) return null;

  const checks = buildPolicyChecks(password, policy);
  const metCount = checks.filter((c) => c.met).length;
  const strength = checks.length === 0 ? 1 : metCount / checks.length;

  const barColor =
    strength === 1
      ? "bg-highlight"
      : strength >= 0.6
        ? "bg-alt"
        : "bg-destructive";

  return (
    <div className="mt-2 space-y-2" aria-label="Password requirements">
      {/* Strength bar */}
      <div
        className="h-1 w-full rounded-full bg-muted overflow-hidden"
        aria-hidden="true"
      >
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor}`}
          style={{ width: `${Math.round(strength * 100)}%` }}
        />
      </div>
      {/* Per-requirement checklist */}
      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2" aria-label="Password requirements">
        {checks.map((check) => (
          <li
            key={check.label}
            className={`flex items-center gap-1.5 text-xs ${
              check.met ? "text-highlight" : "text-muted-foreground"
            }`}
          >
            <span aria-hidden="true">{check.met ? "✓" : "○"}</span>
            <span>{check.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SignupFormProps {
  /** Validated plan ID, used both for the tier field and the read-only display. */
  plan: string;
  /** Human-readable plan name, e.g. "Squad". */
  planDisplayName: string;
  /** Password complexity policy fetched server-side. */
  passwordPolicy: PasswordPolicy;
  /**
   * Stripe publishable key (pk_test_/pk_live_), read from the runtime server
   * env by the signup page and threaded to the Payment Element. NOT the
   * build-time NEXT_PUBLIC var: the shared :main image can't bake a per-env
   * (test vs live) key, so it must arrive at runtime (dashboard#783). Empty
   * string when paid tiers are disabled (kind) — the card step is skipped then.
   */
  publishableKey: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Resolve a CSS custom-property value to a concrete color string the Stripe
// Elements iframe can parse. The design tokens are oklch(); Stripe's appearance
// API does not parse oklch reliably, so paint the value onto a throwaway element
// and read back the browser-computed rgb(). Reading the live token (never a
// hardcoded literal) keeps the no-hardcoded-colors guard happy AND guarantees an
// exact match to the dashboard theme.
function resolveToken(cs: CSSStyleDeclaration, name: string): string {
  const raw = cs.getPropertyValue(name).trim();
  if (!raw || typeof document === "undefined") return raw;
  const probe = document.createElement("span");
  probe.style.color = raw;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  return rgb || raw;
}

// Build a Stripe Elements appearance from the dashboard's live CSS tokens so the
// inline Payment Element matches the single dark brand exactly (dashboard#784
// follow-up: the default light theme rendered a white box that clashed). Runs
// client-side only (reads the DOM).
function buildStripeAppearance(): Appearance {
  const cs = getComputedStyle(document.documentElement);
  const t = (n: string) => resolveToken(cs, n);
  const radius = cs.getPropertyValue("--radius").trim() || "0.5rem";
  return {
    theme: "night",
    variables: {
      fontFamily: cs.getPropertyValue("--font-sans").trim() || "inherit",
      borderRadius: radius,
      colorPrimary: t("--primary"),
      colorBackground: t("--input"),
      colorText: t("--foreground"),
      colorTextSecondary: t("--muted-foreground"),
      colorTextPlaceholder: t("--muted-foreground"),
      colorDanger: t("--destructive"),
    },
    rules: {
      ".Input": { border: `1px solid ${t("--border")}` },
      ".Input:focus": { boxShadow: `0 0 0 1px ${t("--ring")}` },
      ".Label": { color: t("--muted-foreground") },
      ".Tab": { border: `1px solid ${t("--border")}` },
      ".Tab--selected": { borderColor: t("--primary") },
    },
  };
}

// SignupForm wraps the body in a deferred-mode Stripe <Elements> provider so
// the card field renders INLINE with the account fields (no pre-created
// customer/SetupIntent) and is validated client-side before "Create account"
// (dashboard#784). The publishable key is runtime-injected (dashboard#783).
// When paid tiers are off (kind) the key is empty: render without Elements and
// the no-card path runs.
export function SignupForm(props: SignupFormProps) {
  const stripePromise = useMemo(
    () => (props.publishableKey ? loadStripe(props.publishableKey) : null),
    [props.publishableKey],
  );
  // Start dark (theme:'night') so there's no white flash before the token-exact
  // appearance is computed on mount.
  const [appearance, setAppearance] = useState<Appearance>({ theme: "night" });
  useEffect(() => {
    setAppearance(buildStripeAppearance());
  }, []);

  if (!stripePromise) {
    return <SignupFormInner {...props} />;
  }
  return (
    <Elements
      stripe={stripePromise}
      options={{
        // Deferred SetupIntent. Default (automatic) paymentMethodCreation: we
        // confirm via stripe.confirmSetup({elements, clientSecret}). 'manual'
        // would forbid confirmSetup-with-elements (it requires createPaymentMethod
        // instead) and throws an IntegrationError — the "Something went wrong"
        // the signup hit after the customer was created (dashboard#784).
        mode: "setup",
        currency: "usd",
        appearance,
      }}
    >
      <SignupFormInner {...props} />
    </Elements>
  );
}

function SignupFormInner({
  plan,
  planDisplayName,
  passwordPolicy,
  publishableKey,
}: SignupFormProps) {
  // Stripe.js handles (null when paid tiers are off / not inside <Elements>).
  const stripe = useStripe();
  const elements = useElements();
  // Whether this signup collects a card inline. Gated on the publishable key
  // being present (paid tiers enabled).
  const paidFlow = publishableKey !== "";

  const [isProvisioning, setIsProvisioning] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [redirectOnSuccess, setRedirectOnSuccess] = useState<string>("");
  // Inline card state: complete = the Payment Element reports all fields valid;
  // cardError surfaces validation/decline messages next to the card.
  const [cardComplete, setCardComplete] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Track field refs for programmatic focus on server-side field errors.
  const fieldRefs = useRef<Partial<Record<keyof SignupInput, HTMLElement | null>>>({});

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupInputSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      workspaceName: "",
      // tier is pre-filled from the URL query param.
      tier: plan as SignupInput["tier"],
      // Checkboxes start unchecked, the schema requires literal true.
      acceptToS: undefined as unknown as true,
      acceptPrivacy: undefined as unknown as true,
    },
  });

  const { watch } = form;
  const passwordValue = watch("password");
  const workspaceNameValue = watch("workspaceName");

  // Chart-managed reserved-names denylist, fetched once via
  // /api/auth/reserved-names which proxies to the daemon's
  // PlatformOperatorService.GetReservedNames RPC. The K8s admission webhook
  // remains the authoritative gate; this is a UX nicety so users get
  // inline feedback before submit.
  // Spec: tenant-provisioning-unification-phase2 Requirement 4.5.
  const reservedNames = useReservedNames();
  const workspaceSlugPreview = slugify(workspaceNameValue || "");
  const workspaceSlugReserved = isReservedSlug(
    workspaceSlugPreview,
    reservedNames,
  );

  // Debounced "is this slug already a Tenant?" lookup. Mirrors the
  // server-action WORKSPACE_TAKEN check via GET /api/auth/tenant-available
  // so the failure becomes inline before submit (issue dashboard#44).
  // The server-side check in `signupAction` stays as defense-in-depth.
  const workspaceAvailability = useTenantAvailability(workspaceNameValue ?? "");
  const workspaceSlugTaken = workspaceAvailability.available === false;

  // Prevent accidental navigation while provisioning is in progress.
  // Skip the guard once a success redirect URL is set: at that point the
  // panel is about to navigate intentionally (window.location.assign), and
  // browsers fire beforeunload during that navigation too, without this
  // skip, the user gets a "you will lose your saved information" popup
  // every successful signup right before landing on /login.
  useEffect(() => {
    if (!isProvisioning) return;
    if (redirectOnSuccess) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isProvisioning, redirectOnSuccess]);

  const handleRetry = useCallback(() => {
    setIsProvisioning(false);
    setAttemptId(null);
    setRedirectOnSuccess("");
    setCardError(null);
    form.reset({
      firstName: form.getValues("firstName"),
      lastName: form.getValues("lastName"),
      email: form.getValues("email"),
      password: "",
      workspaceName: form.getValues("workspaceName"),
      tier: plan as SignupInput["tier"],
      acceptToS: undefined as unknown as true,
      acceptPrivacy: undefined as unknown as true,
    });
  }, [form, plan]);

  const onSubmit = useCallback(
    async (data: SignupInput) => {
      // Block submission when the slugified workspace name lands on the
      // chart-managed denylist. The K8s admission webhook would reject
      // this anyway with a less friendly error; catching it here gives
      // the user an immediately-actionable message.
      const submitSlug = slugify(data.workspaceName);
      if (isReservedSlug(submitSlug, reservedNames)) {
        form.setError("workspaceName", {
          type: "manual",
          message: `"${submitSlug}" is reserved. Pick a different company name.`,
        });
        fieldRefs.current.workspaceName?.focus();
        return;
      }

      // Validate the card BEFORE creating anything (the core requirement:
      // all validation happens before "Create account"). Deferred Elements
      // validate client-side via elements.submit() with no server round-trip /
      // no customer yet. On any card error we stop here — nothing is created.
      if (paidFlow) {
        if (!stripe || !elements) {
          setCardError("Payment form is still loading. Try again in a moment.");
          return;
        }
        setCardError(null);
        const { error: submitErr } = await elements.submit();
        if (submitErr) {
          setCardError(submitErr.message ?? "Please check your card details.");
          return;
        }
      }

      // Mint the attemptId now (passed to signupAction for progress tracking)
      // but DO NOT switch to the ProvisioningPanel yet: doing so unmounts this
      // form and the Payment Element, and stripe.confirmSetup() requires a
      // mounted Payment Element. We show the panel only AFTER the card is
      // confirmed (below). Until then the form stays mounted + disabled
      // (form.formState.isSubmitting drives the button's "Creating account…").
      const newAttemptId = crypto.randomUUID();
      form.clearErrors();

      try {
        const result = await signupAction(data, newAttemptId);

        if (result.ok && "phase" in result && result.phase === "card") {
          // Phase 1 created ONLY the Stripe customer + a SetupIntent — no
          // account or company yet (dashboard#785). Confirm the card inline
          // (the Payment Element is still mounted), then completeSignup()
          // creates the trialing subscription + account + company.
          if (!stripe || !elements) {
            toast.error("Payment form not ready. Please retry.");
            return;
          }
          const confirmed = await confirmCardSetup({
            // Stripe.js confirmSetup is heavily overloaded; cast to the minimal
            // structural type confirm-card declares (tests pass fakes).
            stripe: stripe as unknown as ConfirmCardStripe,
            elements,
            clientSecret: result.cardClientSecret,
            // Cards confirm inline (no redirect), but Stripe requires a
            // return_url whenever redirect-capable methods are offered.
            returnUrl: `${window.location.origin}/signup`,
          });
          if (!confirmed.ok) {
            setCardError(confirmed.error);
            toast.error(confirmed.error);
            // Form (and Payment Element) is still mounted (we never switched
            // to the panel) so the user can fix the card and resubmit. Nothing
            // was created.
            return;
          }
          // Card cleared. NOW switch to the ProvisioningPanel and create the
          // subscription + account + company under this one submit.
          setAttemptId(newAttemptId);
          setIsProvisioning(true);
          const finished = await completeSignup({
            attemptId: newAttemptId,
            stripeCustomerId: result.stripeCustomerId,
            paymentMethodId: confirmed.paymentMethodId,
            tenantSlug: result.tenantSlug,
            tier: result.tier,
            email: data.email,
            password: data.password,
            workspaceName: data.workspaceName,
            firstName: data.firstName,
            lastName: data.lastName,
          });
          if (finished.ok && "redirect" in finished) {
            setRedirectOnSuccess(finished.redirect);
          } else if (!finished.ok) {
            toast.error(finished.userMessage);
            setAttemptId(null);
            setIsProvisioning(false);
          }
        } else if (result.ok && "redirect" in result) {
          // Autoconfirm (kind dev; paid tiers disabled): provisioning ran
          // inside signupAction. Show the panel now so it reflects the terminal
          // state and follows the redirect.
          setAttemptId(newAttemptId);
          setIsProvisioning(true);
          setRedirectOnSuccess(result.redirect);
          // Panel sees terminalState=ok in Redis and follows redirect.
        } else if (!result.ok) {
          // signupAction failed before any card work. The form is still
          // mounted (we never switched to the panel), so surface the error in
          // place: a toast plus per-field errors so the user can correct and
          // resubmit without losing the inline card form.
          toast.error(result.userMessage);

          if (result.fieldErrors) {
            const errorEntries = Object.entries(result.fieldErrors) as Array<
              [keyof SignupInput, string]
            >;
            for (const [field, message] of errorEntries) {
              form.setError(field, { type: "server", message });
            }
            const firstErrorField = errorEntries[0]?.[0];
            if (firstErrorField) {
              const el = fieldRefs.current[firstErrorField];
              if (el instanceof HTMLElement) {
                el.focus();
              }
            }
          }
        }
      } catch (err) {
        // Log the actual error so it shows up in browser devtools, without
        // this the failure is invisible client-side and the dashboard pod
        // log only sees the Server Action layer's generic 500.
        console.error("[signup] action threw", {
          attemptId: newAttemptId,
          err,
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
        // Drop the panel so the user is back on the form regardless of cause.
        setAttemptId(null);
        setIsProvisioning(false);
        // Deployment skew: this tab's client bundle predates the running
        // dashboard build, so its Server Action IDs are stale and Next.js
        // rejects the call with "Failed to find Server Action". Retrying the
        // same action from this tab can never succeed, only a reload, which
        // fetches the current build's bundle, recovers it. See
        // src/lib/server-action-skew.ts.
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
    [form, stripe, elements, paidFlow, reservedNames],
  );

  // Once the single submit is underway, show the provisioning panel. The card
  // was collected + confirmed inline before this point (no separate step).
  if (attemptId) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-6 px-4 py-12">
        <ProvisioningPanel
          attemptId={attemptId}
          redirectOnSuccess={redirectOnSuccess}
          onRetry={handleRetry}
        />
      </div>
    );
  }

  const isDisabled = form.formState.isSubmitting || isProvisioning;

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">
            Create your account
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Get started with Gibson in under a minute.
          </p>
        </CardHeader>

        <CardContent>
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-5"
              noValidate
            >
              {/* Read-only plan display */}
              <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2">
                <span className="text-sm text-muted-foreground">Plan</span>
                <div className="flex items-center gap-2">
                  <strong className="text-sm font-medium">
                    {planDisplayName}
                  </strong>
                  <Link
                    href="/pricing"
                    className="text-xs underline underline-offset-4 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={isDisabled ? -1 : undefined}
                  >
                    Edit plan
                  </Link>
                </div>
              </div>

              {/* Name row, 2-col on sm+ */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* First name */}
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          ref={(el) => {
                            field.ref(el);
                            fieldRefs.current.firstName = el;
                          }}
                          placeholder="Ada"
                          autoComplete="given-name"
                          disabled={isDisabled}
                          aria-required="true"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Last name */}
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          ref={(el) => {
                            field.ref(el);
                            fieldRefs.current.lastName = el;
                          }}
                          placeholder="Lovelace"
                          autoComplete="family-name"
                          disabled={isDisabled}
                          aria-required="true"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Email */}
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Work email</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        ref={(el) => {
                          field.ref(el);
                          fieldRefs.current.email = el;
                        }}
                        type="email"
                        placeholder="ada@example.com"
                        autoComplete="email"
                        disabled={isDisabled}
                        aria-required="true"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Password */}
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
                            fieldRefs.current.password = el;
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

              {/* Password confirmation */}
              <FormField
                control={form.control}
                name="passwordConfirm"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        ref={(el) => {
                          field.ref(el);
                          fieldRefs.current.passwordConfirm = el;
                        }}
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

              {/* Company name, the form-field name (`workspaceName`),
                  slugified Tenant CR name, and all downstream operator
                  wiring still use the workspace terminology. Only the
                  user-visible label/placeholder/helper text changed in
                  dashboard#44. */}
              <FormField
                control={form.control}
                name="workspaceName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Company Name</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        ref={(el) => {
                          field.ref(el);
                          fieldRefs.current.workspaceName = el;
                        }}
                        placeholder="Acme Security"
                        autoComplete="organization"
                        disabled={isDisabled}
                        aria-required="true"
                        aria-invalid={
                          workspaceSlugReserved || workspaceSlugTaken
                            ? true
                            : undefined
                        }
                      />
                    </FormControl>
                    <p className="text-xs text-muted-foreground">
                      Letters, numbers, spaces, hyphens, and underscores. 2–63 characters.
                    </p>
                    {workspaceSlugPreview && workspaceSlugReserved ? (
                      <p className="text-xs text-destructive">
                        &ldquo;{workspaceSlugPreview}&rdquo; is reserved. Pick a different name.
                      </p>
                    ) : null}
                    {!workspaceSlugReserved && workspaceSlugTaken ? (
                      <p
                        className="text-xs text-destructive"
                        role="alert"
                        aria-live="polite"
                      >
                        That name is already in use, pick a different one.
                      </p>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Inline payment method (card-first signup, dashboard#784).
                  Deferred Payment Element: renders with just the publishable
                  key (no pre-created customer), validated client-side before
                  "Create account". Rendered only when paid tiers are enabled. */}
              {paidFlow ? (
                <div className="space-y-2">
                  <FormLabel>Payment method</FormLabel>
                  <div className="rounded-md border border-border bg-background p-3">
                    <PaymentElement
                      // Accordion (not tabs): the account has several enabled
                      // payment methods; the tabs layout crammed them into one
                      // horizontal row that clipped after ~3. Accordion stacks
                      // them vertically with the card expanded by default, so
                      // every method + all card fields are visible (dashboard#784).
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
                    <p
                      className="text-xs text-destructive"
                      role="alert"
                      aria-live="polite"
                    >
                      {cardError}
                    </p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Start your 14-day free trial. Your card won&apos;t be charged
                    until it ends. Cancel anytime.
                  </p>
                </div>
              ) : null}

              {/* ToS checkbox */}
              <FormField
                control={form.control}
                name="acceptToS"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        ref={(el) => {
                          fieldRefs.current.acceptToS = el;
                        }}
                        checked={field.value === true}
                        onCheckedChange={(checked) => {
                          field.onChange(checked === true ? true : undefined);
                        }}
                        disabled={isDisabled}
                        aria-required="true"
                        id="acceptToS"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel htmlFor="acceptToS" className="font-normal cursor-pointer">
                        I agree to the{" "}
                        <Link
                          href="https://zeroroot.ai/terms"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-4 hover:no-underline"
                          tabIndex={isDisabled ? -1 : undefined}
                        >
                          Terms of Service
                        </Link>
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />

              {/* Privacy checkbox */}
              <FormField
                control={form.control}
                name="acceptPrivacy"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox
                        ref={(el) => {
                          fieldRefs.current.acceptPrivacy = el;
                        }}
                        checked={field.value === true}
                        onCheckedChange={(checked) => {
                          field.onChange(checked === true ? true : undefined);
                        }}
                        disabled={isDisabled}
                        aria-required="true"
                        id="acceptPrivacy"
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel htmlFor="acceptPrivacy" className="font-normal cursor-pointer">
                        I agree to the{" "}
                        <Link
                          href="https://zeroroot.ai/privacy"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-4 hover:no-underline"
                          tabIndex={isDisabled ? -1 : undefined}
                        >
                          Privacy Policy
                        </Link>
                      </FormLabel>
                      <FormMessage />
                    </div>
                  </FormItem>
                )}
              />

              {/* Submit */}
              <Button
                type="submit"
                className="w-full"
                // Block submit when:
                //   - form is mid-submit / provisioning (existing behaviour),
                //   - the slug is on the reserved-names denylist (the K8s
                //     admission webhook would reject this server-side),
                //   - the inline availability lookup says the slug is taken.
                // The dashboard#44 inline check is best-effort UX; the
                // server-action's WORKSPACE_TAKEN check remains as
                // defense-in-depth against the TOCTOU race between two
                // simultaneous signups.
                disabled={
                  isDisabled ||
                  workspaceSlugReserved ||
                  workspaceSlugTaken ||
                  // Card-first: block until the inline card is complete so all
                  // validation is satisfied before the account is created.
                  (paidFlow && !cardComplete)
                }
                aria-busy={isDisabled}
              >
                {isDisabled
                  ? isProvisioning
                    ? "Setting up your workspace…"
                    : "Creating account…"
                  : "Create account"}
              </Button>
            </form>
          </Form>
        </CardContent>

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
