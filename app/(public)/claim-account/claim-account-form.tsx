"use client";

/**
 * Claim-account form — Client Component.
 *
 * Renders password + confirm-password fields with PasswordStrength, submits
 * to `claimAccountAction`, and surfaces user-facing errors returned from
 * the action (TOKEN_EXPIRED, PASSWORD_POLICY, PASSWORD_BREACHED, etc.).
 *
 * On success the action redirects to /dashboard/default; this component
 * never reaches the success branch in production.
 */

import { useState } from "react";
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
import {
  resolveUserFacingError,
  type UserFacingErrorCode,
} from "@/src/lib/errors/user-facing";
import { checkPasswordAction } from "@/app/actions/auth/check-password";
import { claimAccountAction } from "@/app/actions/auth/claim";

interface Props {
  token: string;
  email: string;
  orgName: string;
}

export function ClaimAccountForm({ token, email, orgName }: Props) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [tokenError, setTokenError] = useState<
    "TOKEN_EXPIRED" | "TOKEN_INVALID" | null
  >(null);
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
      const result = await claimAccountAction({
        token,
        password,
        confirmPassword,
      });
      // Action redirects on success; reaching here implies failure.
      if (result && !result.ok) {
        if (result.code === "TOKEN_EXPIRED" || result.code === "TOKEN_INVALID") {
          setTokenError(result.code);
          return;
        }
        setFieldError(result.message);
        toast.error(result.message);
      }
    } catch (err) {
      // Next.js re-throws NEXT_REDIRECT — treat as success and let the browser
      // follow the Location header. For any other error, show a toast.
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("NEXT_REDIRECT")) {
        throw err;
      }
      toast.error("Unable to connect. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (tokenError) {
    const error = resolveUserFacingError(tokenError as UserFacingErrorCode);
    const withAdminCta = {
      ...error,
      action: {
        label: "Ask your admin to resend",
        href: "mailto:?subject=Please%20resend%20my%20Gibson%20invitation",
      },
    };
    return (
      <div className="flex items-center justify-center py-4 lg:h-screen">
        <ErrorDisplay
          error={withAdminCta}
          className="mx-auto w-full max-w-md"
        />
      </div>
    );
  }

  const heading = orgName
    ? `Set a password for ${orgName}`
    : "Set your password";

  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">{heading}</CardTitle>
          <CardDescription>
            Create a password for <span className="font-medium">{email}</span>{" "}
            to finish setting up your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
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
              <PasswordStrength
                id="password-strength"
                password={password}
                onCheckPassword={checkPasswordAction}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="confirm-password">Confirm password</Label>
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
                  aria-label={
                    showConfirm
                      ? "Hide confirm password"
                      : "Show confirm password"
                  }
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
                  Claiming account&hellip;
                </>
              ) : (
                "Claim account"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
