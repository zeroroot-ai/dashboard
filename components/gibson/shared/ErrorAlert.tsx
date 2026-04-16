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
  /** Additional Tailwind classes merged onto the Alert root. */
  className?: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ErrorAlert({
  error,
  title = 'Error',
  retry,
  className,
}: ErrorAlertProps) {
  return (
    <Alert
      variant="destructive"
      className={cn('border-red-900/50', className)}
    >
      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex items-center justify-between gap-4">
        <span>{error.message}</span>
        {retry && (
          <Button
            variant="outline"
            size="sm"
            onClick={retry}
            className="shrink-0 border-red-800/60 bg-red-950/30 text-red-300 hover:bg-red-950/60 hover:text-red-200"
          >
            Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
