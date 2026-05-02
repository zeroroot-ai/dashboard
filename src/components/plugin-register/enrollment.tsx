"use client";

/**
 * Step 5 — Enrollment
 *
 * Displays the bootstrap token and the CLI enroll command the admin pastes on
 * the plugin host. Provides a one-click clipboard copy button.
 *
 * The bootstrap token is single-use and expires within 24 h (per Spec 2 R3.1).
 * We show the expiry timestamp so admins know when they need to re-register.
 *
 * SECURITY: The token is held only in React state (in-memory) and is NOT
 * written to sessionStorage, localStorage, or any other browser persistence.
 *
 * Spec: secrets-tenant-lifecycle Task 14, Requirement 2.
 */

import { useState } from "react";
import Link from "next/link";
import { CheckIcon, ClipboardIcon, ExternalLinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import type { RegisterResult } from "@/app/actions/plugin-register";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatExpiry(unixBigInt: bigint): string {
  try {
    const ms = Number(unixBigInt) * 1000;
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Clipboard copy hook
// ---------------------------------------------------------------------------

function useCopyToClipboard(text: string) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard API may fail in some environments; silently ignore
    }
  }

  return { copied, copy };
}

// ---------------------------------------------------------------------------
// Component props
// ---------------------------------------------------------------------------

export interface EnrollmentStepProps {
  result: RegisterResult;
  onDone: () => void;
}

// ---------------------------------------------------------------------------
// EnrollmentStep component
// ---------------------------------------------------------------------------

export function EnrollmentStep({ result, onDone }: EnrollmentStepProps) {
  const { copied: tokenCopied, copy: copyToken } = useCopyToClipboard(
    result.bootstrapToken,
  );
  const { copied: cmdCopied, copy: copyCommand } = useCopyToClipboard(
    result.enrollCommand,
  );

  const expiryLabel = formatExpiry(result.bootstrapTokenExpiresAtUnix);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Plugin registered</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Your plugin has been registered. Run the enroll command on the host
          where the plugin binary will run. The bootstrap token is{" "}
          <strong>single-use</strong> and expires at {expiryLabel}.
        </p>
      </div>

      <Alert className="border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400">
        <CheckIcon className="size-4" aria-hidden="true" />
        <AlertTitle>Registration successful</AlertTitle>
        <AlertDescription className="text-xs">
          Install ID:{" "}
          <code className="bg-black/10 rounded px-1 font-mono">
            {result.installId}
          </code>
        </AlertDescription>
      </Alert>

      {/* Bootstrap token */}
      <Card className="border-border/60 bg-card/60">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-xs font-medium">Bootstrap token</CardTitle>
          <CardDescription className="text-xs">
            Single-use. Valid until {expiryLabel}. Copy before closing this
            dialog.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="bg-muted flex items-center justify-between gap-2 rounded-md px-3 py-2">
            <code className="break-all font-mono text-xs">
              {result.bootstrapToken}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => void copyToken()}
              aria-label="Copy bootstrap token"
            >
              {tokenCopied ? (
                <CheckIcon className="size-3.5 text-green-500" aria-hidden="true" />
              ) : (
                <ClipboardIcon className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* CLI enroll command */}
      <Card className="border-border/60 bg-card/60">
        <CardHeader className="pb-2 pt-3">
          <CardTitle className="text-xs font-medium">Enroll command</CardTitle>
          <CardDescription className="text-xs">
            Run this on the plugin host to complete enrollment.
          </CardDescription>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="bg-muted flex items-center justify-between gap-2 rounded-md px-3 py-2">
            <code className="break-all font-mono text-xs">
              {result.enrollCommand}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              onClick={() => void copyCommand()}
              aria-label="Copy enroll command"
            >
              {cmdCopied ? (
                <CheckIcon className="size-3.5 text-green-500" aria-hidden="true" />
              ) : (
                <ClipboardIcon className="size-3.5" aria-hidden="true" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        After enrollment, the plugin will appear in the{" "}
        <Link
          href="/dashboard/plugins"
          className="text-primary underline underline-offset-2"
        >
          Plugins page
          <ExternalLinkIcon className="ml-0.5 inline size-3" aria-hidden="true" />
        </Link>{" "}
        once it sends its first heartbeat.
      </p>

      <div className="flex justify-end">
        <Button type="button" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
