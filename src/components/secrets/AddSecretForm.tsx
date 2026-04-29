"use client";

/**
 * AddSecretForm — client-side form component for creating a new secret.
 *
 * Submits via the createSecretAction server action (POST, server-side).
 * The value field is:
 *   - type="password" with autoComplete="off"
 *   - cleared immediately after submit (success or failure) via ref.reset()
 *
 * SECURITY:
 *   - The value never enters any client-side state beyond the FormData submit.
 *   - No localStorage / sessionStorage write. Cypress Task 23 asserts this.
 *   - On success the form is reset so the browser does not retain the value.
 *
 * Spec: secrets-tenant-lifecycle Task 11, Requirements 1.1, 1.3.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createSecretAction } from "@/app/actions/secrets";

// ---------------------------------------------------------------------------
// Category options
// ---------------------------------------------------------------------------

const CATEGORY_OPTIONS = [
  { value: "cred", label: "Credential" },
  { value: "provider_config", label: "Provider config" },
] as const;

type CategoryValue = (typeof CATEGORY_OPTIONS)[number]["value"];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AddSecretForm() {
  const router = useRouter();
  const formRef = React.useRef<HTMLFormElement>(null);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [category, setCategory] = React.useState<CategoryValue>("cred");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    // Override the hidden category field with the controlled state value
    formData.set("category", category);

    try {
      const result = await createSecretAction(formData);

      // SECURITY: clear value field regardless of outcome so the browser does
      // not cache or retain the entered bytes in any form-restoration mechanism.
      formRef.current?.reset();
      // Reset controlled category state to default.
      setCategory("cred");

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Success: navigate to the secrets list with a brief success signal.
      router.push(
        "/dashboard/pages/settings/secrets?created=1"
      );
      router.refresh();
    } catch (err) {
      // Unexpected client-side failure.
      formRef.current?.reset();
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6" noValidate>
      {/* Error alert */}
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Name field */}
      <div className="space-y-2">
        <Label htmlFor="secret-name">
          Name
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <Input
          id="secret-name"
          name="name"
          type="text"
          placeholder="e.g. cred:api_key or provider_config:anthropic:default"
          autoComplete="off"
          spellCheck={false}
          required
          aria-required="true"
          aria-describedby="secret-name-hint"
          disabled={pending}
          className="font-mono"
        />
        <p id="secret-name-hint" className="text-muted-foreground text-xs">
          Letters, digits, hyphens, underscores, colons, and dots. Max 256 characters.
        </p>
      </div>

      {/* Category field */}
      <div className="space-y-2">
        <Label htmlFor="secret-category">
          Category
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        {/* Hidden input carries the controlled value for FormData */}
        <input type="hidden" name="category" value={category} />
        <Select
          value={category}
          onValueChange={(v) => setCategory(v as CategoryValue)}
          disabled={pending}
        >
          <SelectTrigger id="secret-category" aria-required="true">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            {CATEGORY_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Value field — password type, autoComplete off, NEVER stored */}
      <div className="space-y-2">
        <Label htmlFor="secret-value">
          Value
          <span className="text-destructive ml-1" aria-hidden="true">*</span>
        </Label>
        <div className="relative">
          <Input
            id="secret-value"
            name="value"
            type="password"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Paste your secret value here"
            required
            aria-required="true"
            aria-describedby="secret-value-hint"
            disabled={pending}
            data-testid="secret-value-input"
          />
          <EyeOffIcon
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
        </div>
        <p id="secret-value-hint" className="text-muted-foreground text-xs">
          Transmitted securely to the broker over TLS. Never displayed after submission.
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <Loader2Icon className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Saving...
            </>
          ) : (
            "Add secret"
          )}
        </Button>
        <Button variant="outline" asChild disabled={pending}>
          <Link href="/dashboard/pages/settings/secrets">
            <ArrowLeftIcon className="mr-2 h-4 w-4" aria-hidden="true" />
            Cancel
          </Link>
        </Button>
      </div>
    </form>
  );
}
