"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface Requirement {
  label: string;
  test: (password: string) => boolean;
}

const REQUIREMENTS: Requirement[] = [
  {
    label: "At least 12 characters",
    test: (p) => p.length >= 12,
  },
  {
    label: "Uppercase letter",
    test: (p) => /[A-Z]/.test(p),
  },
  {
    label: "Lowercase letter",
    test: (p) => /[a-z]/.test(p),
  },
  {
    label: "Number",
    test: (p) => /[0-9]/.test(p),
  },
  {
    label: "Special character",
    test: (p) => /[^A-Za-z0-9]/.test(p),
  },
];

interface PasswordStrengthProps {
  password: string;
  id?: string;
}

/**
 * PasswordStrength displays five real-time password requirements with
 * pass/fail indicators. Each row announces state changes to screen readers
 * via aria-live="polite".
 *
 * Purely controlled by the `password` prop — no internal state.
 */
export function PasswordStrength({ password, id }: PasswordStrengthProps) {
  return (
    <div id={id} role="list" className="space-y-1.5 text-sm">
      {REQUIREMENTS.map((req) => {
        const passes = req.test(password);
        return (
          <div
            key={req.label}
            role="listitem"
            aria-live="polite"
            aria-label={`${req.label}: ${passes ? "requirement met" : "requirement not met"}`}
            className="flex items-center gap-2"
          >
            {passes ? (
              <CheckIcon
                className="h-4 w-4 shrink-0 text-green-500"
                aria-hidden="true"
              />
            ) : (
              <XIcon
                className={cn(
                  "h-4 w-4 shrink-0",
                  password.length === 0
                    ? "text-muted-foreground"
                    : "text-destructive"
                )}
                aria-hidden="true"
              />
            )}
            <span
              className={cn(
                passes
                  ? "text-green-700 dark:text-green-400"
                  : password.length === 0
                  ? "text-muted-foreground"
                  : "text-destructive"
              )}
            >
              {req.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
