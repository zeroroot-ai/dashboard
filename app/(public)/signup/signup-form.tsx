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

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
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
import { signupAction, resumeSignupAfterPayment } from "@/app/actions/signup";
import { PaymentStep } from "./payment-step";
import {
  isServerActionDeploymentSkew,
  reloadForDeploymentSkew,
} from "@/src/lib/server-action-skew";
import { pricingDisplays } from "@/src/lib/pricing-display";
import type { PasswordPolicy } from "@/src/lib/zitadel/admin-client";
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

export interface SignupFormProps {
  /** Validated plan ID, used both for the tier field and the read-only display. */
  plan: string;
  /** Human-readable plan name, e.g. "Squad". */
  planDisplayName: string;
  /** Password complexity policy fetched server-side. */
  passwordPolicy: PasswordPolicy;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SignupForm({
  plan,
  planDisplayName,
  passwordPolicy,
}: SignupFormProps) {
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [redirectOnSuccess, setRedirectOnSuccess] = useState<string>("");
  // Card-first signup (dashboard#769): set when phase 1 returns
  // awaitingPayment. Carries the phase-2 resume context plus the submitted
  // form data (email/password/workspaceName) so onComplete can finish.
  const [paymentCtx, setPaymentCtx] = useState<{
    tenantSlug: string;
    tier: string;
    zitadelUserId: string;
    data: SignupInput;
  } | null>(null);
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
    setPaymentCtx(null);
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

      // Mint the attemptId BEFORE invoking the action so we can show the
      // ProvisioningPanel immediately. The panel polls /api/signup/progress/:id
      // for live status while the server action runs in the background.
      // Without this, the user stares at a disabled form for 20–30s with no
      // signal that anything is happening.
      const newAttemptId = crypto.randomUUID();
      setAttemptId(newAttemptId);
      setIsProvisioning(true);
      form.clearErrors();

      try {
        const result = await signupAction(data, newAttemptId);

        if (result.ok && "awaitingPayment" in result) {
          // Phase 1 done; pause for in-page card collection. The panel keeps
          // polling (await_payment step) while <PaymentStep> renders.
          setPaymentCtx({
            tenantSlug: result.tenantSlug,
            tier: result.tier,
            zitadelUserId: result.zitadelUserId,
            data,
          });
        } else if (result.ok) {
          setRedirectOnSuccess(result.redirect);
          // Panel sees terminalState=ok in Redis and follows redirect.
        } else {
          // The server has already written a terminal failure state to the
          // progress store; the panel will show the error inline. Also pop
          // a toast for users not looking at the panel + apply per-field
          // errors for retry-time validation feedback.
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
    [form],
  );

  // Card-first signup (dashboard#769): finish phase 2 once the card is
  // confirmed and the trialing subscription created. resumeSignupAfterPayment
  // re-validates against the tenant CR (owner + billing) server-side.
  async function handlePaymentComplete() {
    if (!paymentCtx) return;
    const result = await resumeSignupAfterPayment({
      attemptId: attemptId ?? crypto.randomUUID(),
      tenantSlug: paymentCtx.tenantSlug,
      tier: paymentCtx.tier,
      zitadelUserId: paymentCtx.zitadelUserId,
      email: paymentCtx.data.email,
      password: paymentCtx.data.password,
      workspaceName: paymentCtx.data.workspaceName,
    });
    setPaymentCtx(null);
    if (result.ok && "redirect" in result) {
      setRedirectOnSuccess(result.redirect);
    } else if (!result.ok) {
      toast.error(result.userMessage);
    }
  }

  // Show the provisioning panel once we have an attemptId. When phase 1
  // returned awaitingPayment, render the in-page Payment Element above it.
  if (attemptId) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-6 px-4 py-12">
        {paymentCtx ? (
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6">
            <h2 className="mb-1 text-lg font-semibold text-foreground">
              Add a payment method
            </h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Start your 14-day free trial. You won&apos;t be charged until it ends.
            </p>
            <PaymentStep
              tenantSlug={paymentCtx.tenantSlug}
              tier={paymentCtx.tier}
              onComplete={handlePaymentComplete}
            />
          </div>
        ) : null}
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
                disabled={isDisabled || workspaceSlugReserved || workspaceSlugTaken}
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
