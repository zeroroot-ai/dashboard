// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * CompleteSignupForm — the post-verification screen.
 *
 * It collects the password. The password lives here rather than on /signup
 * because it may not exist for an address nobody has proven they control: a
 * password collected earlier would have to be held across the mail round-trip.
 *
 * When the daemon holds the new tenant for an external signup step
 * (gibson#895), this screen then shows the step texts from config. Its button
 * goes to /signup/step/start, which forwards the browser to the step link.
 * The client never sees the completion session token or the step token; both
 * live in an httpOnly cookie.
 */

import { useCallback, useRef, useState } from "react";
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
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { completeSignup } from "@/app/actions/signup";
import {
  isServerActionDeploymentSkew,
  reloadForDeploymentSkew,
} from "@/src/lib/server-action-skew";
import type { PasswordPolicy } from "@/src/lib/zitadel/password-policy-cache";
import type { VerifiedSignupDisplay } from "@/src/lib/signup/verified-session";
import type { SignupStepText } from "@/src/lib/deployment-profile";
import { PasswordStrengthMeter } from "../password-strength-meter";
import { ProvisioningPanel } from "../provisioning-panel";
import {
  completeSignupInputSchema,
  type CompleteSignupFormInput,
} from "../types";

interface CompleteSignupFormProps {
  /** Display-only view of the verified session. Carries NO completion token. */
  verified: VerifiedSignupDisplay;
  passwordPolicy: PasswordPolicy;
  /** The texts of the external signup step, or null when none is configured. */
  stepText: SignupStepText | null;
}

/** Timeout codes are non-destructive: the account and workspace both exist. */
function isNonFatalTimeout(code: string): boolean {
  return code === "PROVISIONING_TIMEOUT" || code === "MEMBERSHIP_TIMEOUT";
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

export function CompleteSignupForm({
  verified,
  passwordPolicy,
  stepText,
}: CompleteSignupFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [stepPending, setStepPending] = useState(false);
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
      setProvisioning(true);
      try {
        const result = await completeSignup({ password: data.password });
        if (result.ok && "phase" in result && result.phase === "external_step") {
          setProvisioning(false);
          setStepPending(true);
          return;
        }
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
    [form],
  );

  if (stepPending && stepText) {
    return (
      <CompleteShell verified={verified}>
        <h2 className="text-lg font-semibold">{stepText.title}</h2>
        <p className="text-sm text-muted-foreground">{stepText.text}</p>
        <Button asChild className="w-full">
          {/* A plain anchor: the route answers with a redirect to another
              origin, which client-side navigation cannot follow. */}
          <a href="/signup/step/start">{stepText.buttonLabel}</a>
        </Button>
      </CompleteShell>
    );
  }

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
                {/* FormControl wraps the Input itself, not the positioning
                    div, so the Input receives the id that FormLabel points
                    at (dashboard#77). */}
                <div className="relative">
                  <FormControl>
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
                  </FormControl>
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

          <Button
            type="submit"
            className="w-full"
            disabled={isDisabled}
            aria-busy={isDisabled}
          >
            {isDisabled ? "Creating account…" : "Create account"}
          </Button>
        </form>
      </Form>
    </CompleteShell>
  );
}
