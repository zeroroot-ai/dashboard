"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Captcha } from "@/components/gibson/auth/captcha";
import { forgotPasswordAction } from "@/app/actions/auth/forgot-password";

// ---------------------------------------------------------------------------
// Success message — constant regardless of whether the email matched
// ---------------------------------------------------------------------------

const GENERIC_SUCCESS =
  "If an account exists for that email, a reset link has been sent.";

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(
    undefined,
  );

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEmailError(null);

    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError("Please enter a valid email address.");
      return;
    }

    setIsSubmitting(true);
    try {
      await forgotPasswordAction({ email: trimmed, captchaToken });
    } finally {
      setIsSubmitting(false);
      // Always show success — enumeration resistance. Even a CAPTCHA
      // failure returns the generic success from the server, so we never
      // signal that a challenge was required.
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="flex items-center justify-center py-4 lg:h-screen">
        <Card className="mx-auto w-96">
          <CardHeader>
            <CardTitle className="text-2xl">Check your inbox</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{GENERIC_SUCCESS}</p>
            <Link
              href="/login"
              className="text-sm underline underline-offset-4 hover:text-foreground"
            >
              Return to sign in
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <Card className="mx-auto w-96">
        <CardHeader>
          <CardTitle className="text-2xl">Forgot your password?</CardTitle>
          <CardDescription>
            Enter the email address associated with your account and we&apos;ll
            send you a reset link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSubmitting}
                aria-describedby={emailError ? "email-error" : undefined}
                aria-invalid={emailError ? "true" : undefined}
              />
              {emailError && (
                <p
                  id="email-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {emailError}
                </p>
              )}
            </div>

            {/* CAPTCHA widget — renders null when provider is disabled/unset. */}
            <Captcha
              action="forgot-password"
              onToken={(token) => setCaptchaToken(token)}
            />

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                  Sending&hellip;
                </>
              ) : (
                "Send reset link"
              )}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm">
            Remember your password?{" "}
            <Link href="/login" className="underline underline-offset-4">
              Sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page (Suspense boundary for potential search-param reads)
// ---------------------------------------------------------------------------

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-4 lg:h-screen">
          <Loader2Icon className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <ForgotPasswordForm />
    </Suspense>
  );
}
