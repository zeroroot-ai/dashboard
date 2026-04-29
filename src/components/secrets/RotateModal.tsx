"use client";

/**
 * RotateModal — Dialog form to rotate a secret's value.
 *
 * Mirrors the AddSecretForm security model:
 *   - value field is type="password" autoComplete="off"
 *   - form is reset on submit (success or failure)
 *   - NO localStorage / sessionStorage involvement
 *
 * On success: calls onSuccess() (parent closes the dialog and refreshes).
 *
 * Spec: secrets-tenant-lifecycle Task 12, Requirement 1.1.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon, EyeOffIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { rotateSecretAction } from "@/app/actions/secrets";

export interface RotateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  secretName: string;
  onSuccess?: () => void;
}

export function RotateModal({
  open,
  onOpenChange,
  secretName,
  onSuccess,
}: RotateModalProps) {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleClose(open: boolean) {
    if (!pending) {
      setError(null);
      formRef.current?.reset();
      onOpenChange(open);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(event.currentTarget);

    try {
      const result = await rotateSecretAction(secretName, formData);

      // SECURITY: clear value regardless of outcome.
      formRef.current?.reset();

      if (!result.ok) {
        setError(result.error);
        return;
      }

      onOpenChange(false);
      onSuccess?.();
      router.refresh();
    } catch (err) {
      formRef.current?.reset();
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate secret</DialogTitle>
          <DialogDescription>
            Enter a new value for{" "}
            <code className="text-foreground rounded bg-muted px-1 py-0.5 text-sm font-mono">
              {secretName}
            </code>
            . The version counter will increment. The previous value is immediately
            replaced in the backend.
          </DialogDescription>
        </DialogHeader>

        <form ref={formRef} onSubmit={handleSubmit} className="space-y-4" noValidate>
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="rotate-value">
              New value
              <span className="text-destructive ml-1" aria-hidden="true">*</span>
            </Label>
            <div className="relative">
              <Input
                id="rotate-value"
                name="value"
                type="password"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Paste new secret value"
                required
                aria-required="true"
                disabled={pending}
                data-testid="rotate-value-input"
              />
              <EyeOffIcon
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
            <p className="text-muted-foreground text-xs">
              Transmitted securely over TLS. Never displayed after rotation.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? (
                <>
                  <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                  Rotating...
                </>
              ) : (
                "Rotate secret"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
