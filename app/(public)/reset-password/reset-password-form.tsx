"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

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
import { PasswordStrength } from "@/components/gibson/auth/password-strength";
import { ErrorDisplay } from "@/components/gibson/auth/ErrorDisplay";
import { resolveUserFacingError } from "@/src/lib/errors/user-facing";
import { checkPasswordAction } from "@/app/actions/auth/check-password";
import { resetPasswordAction } from "@/app/actions/auth/reset-password";
import type { UserFacingErrorCode } from "@/src/lib/errors/user-facing";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ResetPasswordFormProps {
  token: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Client component that renders the new-password + confirm-password fields.
 * Validates locally before calling `resetPasswordAction`. Displays
 * `PasswordStrength` with live HIBP checking.
 */
export function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tokenError, setTokenError] = useState<"TOKEN_EXPIRED" | "TOKEN_INVALID" | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFieldError(null);
    setTokenError(null);

    if (password !== confirmPassword) {
      setFieldError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await resetPasswordAction({ token, password, confirmPassword });
      if (!result.ok) {
        if (result.code === "TOKEN_EXPIRED" || result.code === "TOKEN_INVALID") {
          setTokenError(result.code);
          return;
        }
        if (result.code === "CONFIRM_MISMATCH") {
          setFieldError("Passwords do not match.");
          return;
        }
        // PASSWORD_POLICY or SERVICE_UNAVAILABLE
        setFieldError(result.message);
        toast.error(result.message);
        return;
      }
      // ok:true path — action will redirect; this code is never reached
      // in production but we toast in case the redirect is caught.
      toast.success("Password updated successfully.");
    } catch {
      toast.error("Unable to connect. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Token is no longer valid — show the user-facing error card.
  if (tokenError) {
    const error = resolveUserFacingError(tokenError as UserFacingErrorCode);
    return (
      <div className="flex items-center justify-center py-4 lg:h-screen">
        <ErrorDisplay error={error} className="mx-auto w-full max-w-md" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Set a new password</CardTitle>
          <CardDescription>
            Choose a strong password you haven&apos;t used before.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
            {/* New password */}
            <div className="grid gap-2">
              <Label htmlFor="password">New password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  className="pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={isSubmitting}
                  aria-describedby="password-strength"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              <PasswordStrength
                id="password-strength"
                password={password}
                onCheckPassword={checkPasswordAction}
              />
            </div>

            {/* Confirm password */}
            <div className="grid gap-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <div className="relative">
                <Input
                  id="confirm-password"
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  className="pr-10"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={isSubmitting}
                  aria-describedby={fieldError ? "field-error" : undefined}
                  aria-invalid={fieldError ? "true" : undefined}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? "Hide confirm password" : "Show confirm password"}
                  tabIndex={-1}
                >
                  {showConfirm ? (
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {fieldError && (
                <p
                  id="field-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  {fieldError}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2Icon className="animate-spin" aria-hidden="true" />
                  Updating&hellip;
                </>
              ) : (
                "Update password"
              )}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm">
            <Link href="/login" className="underline underline-offset-4">
              Return to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
