"use client";

import { Suspense, useState, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { signUpAction } from "@/app/actions/auth/signup";
import { signupSchema, type SignupInput } from "@/src/lib/validators/auth";
import { resolveUserFacingError } from "@/src/lib/errors/user-facing";
import { Captcha } from "@/components/gibson/auth/captcha";
import { ErrorDisplay } from "@/components/gibson/auth/ErrorDisplay";
import { SocialProvidersBlock } from "@/src/components/auth/SocialProvidersBlock";
import type { ProviderId } from "@/src/lib/social-providers";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PasswordStrength } from "@/components/gibson/auth/password-strength";
import { plans } from "@/src/lib/plans";
import type { UserFacingError } from "@/src/lib/errors/user-facing";

// Signup schema lives in src/lib/validators/auth.ts so the server-side
// signUpAction enforces the same rules as the form.
type SignupFormValues = SignupInput;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(plan: (typeof plans)[number]): string {
  if (plan.monthlyPrice === null) return "Contact sales";
  return `$${plan.monthlyPrice}/mo`;
}

/**
 * Convert a company name to a URL-safe slug.
 * Examples:
 *   "Acme Security"     → "acme-security"
 *   "Zero-Day AI, Inc." → "zero-day-ai-inc"
 *   "My Company 123"    → "my-company-123"
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric runs with hyphens
    .replace(/^-+|-+$/g, "") // strip leading/trailing hyphens
    .slice(0, 63); // Postgres label limit
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SignupFormProps {
  /** Ordered list of enabled social provider IDs from the server. */
  providers: ProviderId[];
}

// ---------------------------------------------------------------------------
// Form component
// ---------------------------------------------------------------------------

function SignupFormInner({ providers }: SignupFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planId = searchParams.get("plan") || "indie";

  const selectedPlan =
    plans.find((p) => p.id === planId) ?? plans.find((p) => p.id === "indie")!;

  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(
    undefined,
  );
  /** Page-level error (EMAIL_ALREADY_REGISTERED, SERVICE_UNAVAILABLE, …). */
  const [pageError, setPageError] = useState<UserFacingError | null>(null);

  const passwordRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<SignupFormValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      companyName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const watchedPassword = form.watch("password");
  const showPasswordStrength = passwordFocused || watchedPassword.length > 0;

  async function onSubmit(data: SignupFormValues) {
    setIsLoading(true);
    setPageError(null);
    try {
      const tenantSlug = slugify(data.companyName);

      const result = await signUpAction({
        companyName: data.companyName,
        email: data.email,
        password: data.password,
        confirmPassword: data.confirmPassword,
        tosAccepted: data.tosAccepted,
        plan: selectedPlan.tier,
        captchaToken,
      });

      if (!result.ok) {
        switch (result.code) {
          // ── Field-level errors ──────────────────────────────────────────
          case "COMPANY_NAME_TAKEN":
            form.setError("companyName", {
              message:
                "A workspace with that name already exists. Please choose a different name.",
            });
            return;

          case "PASSWORD_BREACHED":
            form.setError("password", {
              message:
                "This password has appeared in a known data breach. Please choose a different password.",
            });
            return;

          case "PASSWORD_POLICY":
          case "VALIDATION":
            if (result.field === "password") {
              form.setError("password", { message: result.message });
            } else if (result.field === "email") {
              form.setError("email", { message: result.message });
            } else if (result.field === "companyName") {
              form.setError("companyName", { message: result.message });
            } else {
              toast.error(result.message);
            }
            return;

          // ── Page-level errors ───────────────────────────────────────────
          case "EMAIL_ALREADY_REGISTERED":
            setPageError(
              resolveUserFacingError(
                "EMAIL_ALREADY_REGISTERED",
                result.correlationId,
              ),
            );
            return;

          case "CAPTCHA_FAILED":
            setPageError(
              resolveUserFacingError("CAPTCHA_FAILED", result.correlationId),
            );
            return;

          case "SERVICE_UNAVAILABLE":
            setPageError(
              resolveUserFacingError(
                "SERVICE_UNAVAILABLE",
                result.correlationId,
              ),
            );
            return;

          case "RATE_LIMITED":
            toast.error(result.message);
            return;

          default:
            toast.error(result.message);
            return;
        }
      }

      if (result.redirectUrl) {
        if (!result.redirectUrl.startsWith("https://checkout.stripe.com/")) {
          toast.error("Invalid payment redirect URL. Please contact support.");
          return;
        }
        window.location.href = result.redirectUrl;
        return;
      }

      router.push(
        `/signup/provisioning?tenant=${encodeURIComponent(result.tenantId || tenantSlug)}&user=${encodeURIComponent(result.userId)}`,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      console.error("[signup] onSubmit failed:", e);
      const debug = process.env.NEXT_PUBLIC_DASHBOARD_DEBUG === "1";
      toast.error(
        debug
          ? `Signup error: ${e.message}`
          : "An error occurred. Please try again.",
      );
    } finally {
      setIsLoading(false);
    }
  }

  // Show a full-page error card for page-level errors (EMAIL_ALREADY_REGISTERED,
  // SERVICE_UNAVAILABLE, CAPTCHA_FAILED). The form is still mounted beneath so
  // the user can dismiss and correct without a page reload.
  if (pageError) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
        <div className="w-full max-w-md space-y-4">
          <ErrorDisplay error={pageError} className="w-full" />

          {/* EMAIL_ALREADY_REGISTERED gets additional action links */}
          {pageError.code === "EMAIL_ALREADY_REGISTERED" && (
            <div className="flex gap-4 justify-center text-sm">
              <Link
                href="/login"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Sign in
              </Link>
              <span className="text-muted-foreground">·</span>
              <Link
                href="/forgot-password"
                className="font-medium text-foreground underline-offset-4 hover:underline"
              >
                Reset password
              </Link>
            </div>
          )}

          <div className="text-center">
            <button
              type="button"
              onClick={() => setPageError(null)}
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Back to sign up
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-4">
        {/* Plan summary card */}
        <Card className="border-muted">
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Selected plan
              </p>
              <p className="mt-0.5 font-semibold">{selectedPlan.name}</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-lg font-bold">{formatPrice(selectedPlan)}</span>
              <Link
                href="/pricing"
                className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Change plan
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Registration form card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Create your account</CardTitle>
            <CardDescription>
              Get started with Zero Day AI on the {selectedPlan.name} plan.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Social sign-up buttons — renders nothing when no providers are enabled */}
            <SocialProvidersBlock
              providers={providers}
              mode="signup"
            />

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">

                {/* Company Name */}
                <FormField
                  control={form.control}
                  name="companyName"
                  render={({ field }) => (
                    <FormItem className="grid gap-2">
                      <FormLabel htmlFor="companyName">Company / Team Name</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          id="companyName"
                          type="text"
                          autoComplete="organization"
                          placeholder="Acme Security"
                          aria-describedby={
                            form.formState.errors.companyName
                              ? "companyName-error"
                              : undefined
                          }
                        />
                      </FormControl>
                      <FormMessage id="companyName-error" />
                    </FormItem>
                  )}
                />

                {/* Email */}
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="grid gap-2">
                      <FormLabel htmlFor="email">Email</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          id="email"
                          type="email"
                          autoComplete="email"
                          placeholder="you@example.com"
                          aria-describedby={
                            form.formState.errors.email
                              ? "email-error"
                              : undefined
                          }
                        />
                      </FormControl>
                      <FormMessage id="email-error" />
                    </FormItem>
                  )}
                />

                {/* Password */}
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem className="grid gap-2">
                      <FormLabel htmlFor="password">Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            id="password"
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            className="pr-10"
                            aria-describedby={[
                              "password-requirements",
                              form.formState.errors.password
                                ? "password-error"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            onFocus={() => setPasswordFocused(true)}
                            onBlur={() => setPasswordFocused(false)}
                            ref={(el) => {
                              field.ref(el);
                              passwordRef.current = el;
                            }}
                          />
                          <button
                            type="button"
                            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                            onClick={() => setShowPassword((v) => !v)}
                            aria-label={
                              showPassword ? "Hide password" : "Show password"
                            }
                            tabIndex={-1}
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage id="password-error" />

                      {/* Real-time password requirements */}
                      {showPasswordStrength && (
                        <PasswordStrength
                          id="password-requirements"
                          password={watchedPassword}
                        />
                      )}
                    </FormItem>
                  )}
                />

                {/* Confirm Password */}
                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem className="grid gap-2">
                      <FormLabel htmlFor="confirmPassword">
                        Confirm Password
                      </FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            {...field}
                            id="confirmPassword"
                            type={showConfirmPassword ? "text" : "password"}
                            autoComplete="new-password"
                            className="pr-10"
                            aria-describedby={
                              form.formState.errors.confirmPassword
                                ? "confirmPassword-error"
                                : undefined
                            }
                          />
                          <button
                            type="button"
                            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                            onClick={() =>
                              setShowConfirmPassword((v) => !v)
                            }
                            aria-label={
                              showConfirmPassword
                                ? "Hide confirm password"
                                : "Show confirm password"
                            }
                            tabIndex={-1}
                          >
                            {showConfirmPassword ? (
                              <EyeOff className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Eye className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage id="confirmPassword-error" />
                    </FormItem>
                  )}
                />

                {/* Terms of Service */}
                <FormField
                  control={form.control}
                  name="tosAccepted"
                  render={({ field }) => (
                    <FormItem className="grid gap-2">
                      <div className="flex items-start gap-3">
                        <FormControl>
                          <Checkbox
                            id="tosAccepted"
                            className="mt-0.5 border-green-500/60 data-[state=checked]:bg-green-500 data-[state=checked]:border-green-500 data-[state=checked]:text-black"
                            checked={field.value === true}
                            onCheckedChange={(checked) =>
                              field.onChange(checked ? true : false)
                            }
                            aria-describedby={
                              form.formState.errors.tosAccepted
                                ? "tosAccepted-error"
                                : undefined
                            }
                          />
                        </FormControl>
                        <FormLabel
                          htmlFor="tosAccepted"
                          className="cursor-pointer text-sm font-normal leading-relaxed text-foreground/90"
                        >
                          I agree to the{" "}
                          <Link
                            href="/terms"
                            className="font-medium text-green-300 underline-offset-4 hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Terms of Service
                          </Link>{" "}
                          and{" "}
                          <Link
                            href="/privacy"
                            className="font-medium text-green-300 underline-offset-4 hover:underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Privacy Policy
                          </Link>
                        </FormLabel>
                      </div>
                      <FormMessage id="tosAccepted-error" />
                    </FormItem>
                  )}
                />

                {/* CAPTCHA widget — renders null when provider is disabled/unset */}
                <Captcha
                  action="signup"
                  onToken={(token) => setCaptchaToken(token)}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    "Create account"
                  )}
                </Button>
              </form>
            </Form>

            <div className="mt-4 space-y-2 text-center text-sm text-muted-foreground">
              <p>
                <Link
                  href="/pricing"
                  className="underline-offset-4 hover:text-foreground hover:underline"
                >
                  Back to pricing
                </Link>
              </p>
              <p>
                Already have an account?{" "}
                <Link
                  href="/login"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function SignupForm({ providers }: SignupFormProps) {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SignupFormInner providers={providers} />
    </Suspense>
  );
}
