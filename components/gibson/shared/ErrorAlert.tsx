'use client';

import { AlertTriangle } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ErrorAlertProps {
  /** The error to display. Accepts a native Error or any object with a message string. */
  error: Error | { message: string };
  /** Heading text rendered in AlertTitle. Defaults to "Error". */
  title?: string;
  /** When provided, renders a Retry button that invokes this callback. */
  retry?: () => void;
  /**
   * Optional support/correlation id from the API error envelope. When present
   * it is rendered as a quotable "Reference: <id>" line so users can give it to
   * support — matching the error-banner copy that promises a reference.
   */
  reference?: string;
  /** Additional Tailwind classes merged onto the Alert root. */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ErrorAlert({
  error,
  title = 'Error',
  retry,
  reference,
  className,
}: ErrorAlertProps) {
  return (
    <Alert
      variant="destructive"
      className={cn('border-destructive/50', className)}
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <span>{error.message}</span>
          {retry && (
            <Button
              variant="outline"
              size="sm"
              onClick={retry}
              className="shrink-0 border-destructive/60 bg-destructive/10/30 text-destructive hover:bg-destructive/10/60 hover:text-destructive"
            >
              Retry
            </Button>
          )}
        </div>
        {reference && (
          <span className="font-mono text-xs opacity-80">
            Reference: {reference}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
