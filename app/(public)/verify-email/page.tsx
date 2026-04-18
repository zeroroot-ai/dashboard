"use client";

/**
 * /verify-email — pending-verification landing page.
 *
 * Shown to users who have signed up but not yet clicked the verification
 * link in their inbox. The dashboard layout gate redirects unverified
 * users here before they can access any protected page.
 *
 * Features:
 *   - Displays the pending email (from `?email=` query param or session).
 *   - "Resend email" button with a 60s cooldown and disabled state during
 *     the cooldown window.
 *   - Toast on successful resend; friendly rate-limit error toast.
 *   - "Change email" link (placeholder → /login for now).
 *   - "Sign out" button via signOutAction.
 *   - CAPTCHA widget (Task 31) — rendered when the provider is enabled;
 *     the token is passed to `resendVerificationAction`. Renders null in
 *     disabled/unset provider mode.
 */

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, MailCheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Captcha } from "@/components/gibson/auth/captcha";
import { resendVerificationAction } from "@/app/actions/auth/resend-verification";
import { signOutAction } from "@/app/actions/auth/signout";

const COOLDOWN_SECONDS = 60;

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(
    undefined,
  );

  // Tick the cooldown counter down once per second.
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const id = setInterval(() => {
      setCooldownRemaining((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownRemaining]);

  const handleResend = useCallback(async () => {
    if (cooldownRemaining > 0 || isSending) return;

    setIsSending(true);
    try {
      const result = await resendVerificationAction({ captchaToken });

      if (result.ok) {
        toast.success("Verification email sent. Check your inbox.");
        setCooldownRemaining(COOLDOWN_SECONDS);
        // Burn the one-shot token so the user must re-solve on the next resend.
        setCaptchaToken(undefined);
        return;
      }

      if (result.code === "CAPTCHA_FAILED") {
        toast.error(
          "Please complete the verification challenge before resending.",
        );
        setCaptchaToken(undefined);
        return;
      }

      if (result.code === "RATE_LIMITED") {
        const wait = result.retryAfterSeconds ?? COOLDOWN_SECONDS;
        toast.error(
          `Please wait ${wait} second${wait === 1 ? "" : "s"} before requesting another email.`,
        );
        setCooldownRemaining(wait);
        return;
      }

      if (result.code === "UNAUTHENTICATED") {
        toast.error("You are not signed in. Please sign in and try again.");
        return;
      }

      toast.error("Unable to resend the verification email. Please try again.");
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsSending(false);
    }
  }, [cooldownRemaining, isSending, captchaToken]);

  const resendDisabled = isSending || cooldownRemaining > 0;

  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <Card className="mx-auto w-[420px]">
        <CardHeader className="flex flex-col items-center gap-2 text-center">
          <MailCheckIcon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-2xl">Check your inbox</CardTitle>
          <CardDescription>
            {email ? (
              <>
                We sent a verification link to{" "}
                <span className="font-medium text-foreground">{email}</span>. Check
                your inbox and click the link to continue.
              </>
            ) : (
              "We sent a verification link to your email address. Check your inbox and click the link to continue."
            )}
          </CardDescription>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          {/* CAPTCHA widget — renders null when provider is disabled/unset. */}
          <Captcha
            action="resend-verification"
            onToken={(token) => setCaptchaToken(token)}
          />

          <Button
            onClick={handleResend}
            disabled={resendDisabled}
            variant="default"
            className="w-full"
            aria-live="polite"
          >
            {isSending ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Sending&hellip;
              </>
            ) : cooldownRemaining > 0 ? (
              `Resend email (${cooldownRemaining}s)`
            ) : (
              "Resend email"
            )}
          </Button>
        </CardContent>

        <CardFooter className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <p>
            Wrong address?{" "}
            <Link
              href="/login"
              className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
            >
              Change email
            </Link>
          </p>
          <button
            type="button"
            onClick={() => signOutAction("/login")}
            className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
          >
            Sign out
          </button>
        </CardFooter>
      </Card>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-4 lg:h-screen">
          <Loader2Icon className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
