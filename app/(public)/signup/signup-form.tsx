"use client";

/**
 * SignupForm, Client Component — step ONE of self-serve signup.
 *
 * Controlled form built with react-hook-form + zodResolver(signupInputSchema).
 * Fields (in DOM order): firstName, lastName, email, workspaceName, acceptToS
 * checkbox, acceptPrivacy checkbox.
 *
 * There is NO password field and NO card field here, and their absence is the
 * whole point of this screen. Submitting asks the daemon to email a single-use
 * verification link and nothing else happens: no account, no billing customer,
 * no workspace. The password and the card are collected on /signup/complete,
 * which is only reachable by following that link.
 *
 * On submit:
 *  1. Disables the form.
 *  2. Calls `signupAction(data)` (Server Action).
 *  3. On success → renders the "check your email" state. The response is
 *     identical whether or not the address already has an account, so this
 *     screen must not branch on it.
 *  4. On failure → displays the userMessage via sonner toast, focuses the
 *     first errored field if `fieldErrors` is present.
 *
 * Branding: uses the dashboard's CSS custom properties from globals.css /
 * themes.css via Shadcn's Card, Input, Label, Checkbox, Button, and Form
 * primitives. Matches `/login` visual weight.
 */

import { useCallback, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import Link from "next/link";
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
import { signupAction } from "@/app/actions/signup";
import {
  isServerActionDeploymentSkew,
  reloadForDeploymentSkew,
} from "@/src/lib/server-action-skew";
import { isReservedSlug, slugify } from "@/src/lib/signup/slug";
import { useReservedNames } from "@/src/lib/signup/use-reserved-names";
import { useTenantAvailability } from "@/src/lib/signup/use-tenant-availability";
import { signupInputSchema, type SignupInput } from "./types";

// ---------------------------------------------------------------------------
// Non-fatal timeout codes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SignupFormProps {
  /** Validated plan ID, used both for the tier field and the read-only display. */
  plan: string;
  /** Human-readable plan name, e.g. "Squad". */
  planDisplayName: string;
  /**
   * Full URL of the marketing pricing page, e.g. "https://www.zeroroot.ai/pricing".
   * Derived server-side from WWW_URL (dashboard#917 / deploy#1055).
   * Null on self-hosted (WWW_URL unset) — the "Edit plan" link is hidden so
   * self-hosted users are never bounced off-cluster to the SaaS marketing site.
   */
  pricingUrl: string | null;
  /**
   * Whether the deployment profile has billing enabled (SaaS). When false
   * (self-hosted / card-free profile): the plan display row, Stripe Elements,
   * and payment-method field are all omitted. The form collects only email,
   * password, and workspace name. When true the card-first SaaS flow renders
   * exactly as before (no regression). dashboard#923 / PRD dashboard#920.
   */
  billingEnabled: boolean;
  /**
   * Full URL of the Terms of Service page, e.g. "https://www.zeroroot.ai/terms".
   * Derived server-side from marketingUrl (dashboard#924 / PRD dashboard#920).
   * Null on self-hosted (WWW_URL unset) — the ToS checkbox link is omitted so
   * self-hosted users are never sent to a dead off-cluster page.
   */
  termsUrl: string | null;
  /**
   * Full URL of the Privacy Policy page, e.g. "https://www.zeroroot.ai/privacy".
   * Derived server-side from marketingUrl (dashboard#924 / PRD dashboard#920).
   * Null on self-hosted (WWW_URL unset) — the privacy checkbox link is omitted.
   */
  privacyUrl: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// SignupForm collects the account details ONLY. It no longer mounts Stripe.
//
// The card step moved to /signup/complete, which runs after the emailed link is
// redeemed. That is not a layout preference: a Payment Element needs a
// SetupIntent, a SetupIntent needs a customer, and creating a customer here
// would mean a billing object exists for an address nobody has proven they
// control. Submitting this form sends one email and creates nothing else.
export function SignupForm({
  plan,
  planDisplayName,
  pricingUrl,
  billingEnabled,
  termsUrl,
  privacyUrl,
}: SignupFormProps) {
  // `sent` is the terminal state of this screen. There is no provisioning
  // panel here any more: submitting sends a verification message and stops.
  const [sent, setSent] = useState<string | null>(null);

  // Track field refs for programmatic focus on server-side field errors.
  const fieldRefs = useRef<Partial<Record<keyof SignupInput, HTMLElement | null>>>({});

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupInputSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      workspaceName: "",
      // tier is pre-filled from the URL query param.
      tier: plan as SignupInput["tier"],
      // Checkboxes start unchecked, the schema requires literal true.
      acceptToS: undefined as unknown as true,
      acceptPrivacy: undefined as unknown as true,
    },
  });

  const { watch } = form;
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

      // The attempt id is minted here and carried through the emailed link, so
      // the progress stream survives the round-trip through the mailbox.
      const newAttemptId = crypto.randomUUID();
      form.clearErrors();

      try {
        const result = await signupAction(data, newAttemptId);

        if (result.ok) {
          // Identical for a brand-new address and one that already has an
          // account. Do NOT try to tell the user which case they are in: the
          // daemon deliberately does not say, because an anonymous caller is
          // not entitled to learn whether an address is registered. Whoever
          // owns the mailbox finds out, in the message they receive.
          setSent(data.email);
          return;
        }

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
    [form, reservedNames],
  );

  // Terminal state of this screen. Note what it does NOT offer: a way to ask
  // whether the address was already registered, or a resend button that would
  // let this page probe the send cooldown.
  if (sent) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md mx-auto">
          <CardHeader>
            <CardTitle className="text-2xl font-bold">Check your email</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              If we can reach <span className="font-medium text-foreground">{sent}</span>,
              a message is on its way. Open the link in it to choose a password
              and finish setting up your workspace.
            </p>
            <p className="text-sm text-muted-foreground">
              The link is good for 24 hours and can only be used once. Nothing
              has been created yet.
            </p>
          </CardContent>
          <CardFooter className="flex justify-center">
            <p className="text-sm text-muted-foreground">
              Wrong address?{" "}
              <Link
                href="/signup"
                className="underline underline-offset-4 hover:no-underline font-medium"
              >
                Start over
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const isDisabled = form.formState.isSubmitting;

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
              {/* Read-only plan display — SaaS only (billingEnabled).
                  Self-hosted (billingEnabled=false): plans are a SaaS concept;
                  self-hosted runs unlimited-metered entitlements with no plan
                  picker. Hide this row entirely on the card-free profile so
                  the form is clean: email / password / workspace only.
                  dashboard#923 / PRD dashboard#920. */}
              {billingEnabled && (
                <div className="flex items-center justify-between rounded-md border border-border bg-muted/50 px-3 py-2">
                  <span className="text-sm text-muted-foreground">Plan</span>
                  <div className="flex items-center gap-2">
                    <strong className="text-sm font-medium">
                      {planDisplayName}
                    </strong>
                    {/* "Edit plan" link is SaaS-only (dashboard#917).
                        Hidden on self-hosted (pricingUrl null) so users are
                        never bounced off-cluster to the marketing site. */}
                    {pricingUrl !== null && (
                      <Link
                        href={pricingUrl}
                        className="text-xs underline underline-offset-4 text-muted-foreground hover:text-foreground transition-colors"
                        tabIndex={isDisabled ? -1 : undefined}
                      >
                        Edit plan
                      </Link>
                    )}
                  </div>
                </div>
              )}

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
                        {/* ToS link is SaaS-only (dashboard#924). On self-hosted
                            (termsUrl null) render plain text so the checkbox still
                            functions without a dead off-cluster link. */}
                        {termsUrl !== null ? (
                          <Link
                            href={termsUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-4 hover:no-underline"
                            tabIndex={isDisabled ? -1 : undefined}
                          >
                            Terms of Service
                          </Link>
                        ) : (
                          <span className="underline underline-offset-4">Terms of Service</span>
                        )}
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
                        {/* Privacy link is SaaS-only (dashboard#924). On self-hosted
                            (privacyUrl null) render plain text so the checkbox still
                            functions without a dead off-cluster link. */}
                        {privacyUrl !== null ? (
                          <Link
                            href={privacyUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-4 hover:no-underline"
                            tabIndex={isDisabled ? -1 : undefined}
                          >
                            Privacy Policy
                          </Link>
                        ) : (
                          <span className="underline underline-offset-4">Privacy Policy</span>
                        )}
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
                  workspaceSlugTaken
                }
                aria-busy={isDisabled}
              >
                {isDisabled ? "Sending…" : "Continue"}
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
