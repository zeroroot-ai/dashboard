"use client";

/**
 * PasswordStrengthMeter — the live requirement checklist under a password
 * field.
 *
 * It lives on its own because the password is no longer collected on the first
 * signup screen. It is collected on the completion screen, after the address
 * has been proven, and this component moves with it. Advisory only: the
 * identity service enforces the real policy at user-create time.
 */

import type { PasswordPolicy } from "@/src/lib/zitadel/password-policy-cache";

interface PolicyCheck {
  label: string;
  met: boolean;
}

export function buildPolicyChecks(
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

export function PasswordStrengthMeter({
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

