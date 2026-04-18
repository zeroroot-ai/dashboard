"use client";

/**
 * /signin/provide-email — Email collection page for GitHub private-email users.
 *
 * Shown when a GitHub user completes OAuth but has their email set to private.
 * The GitHub callback route generates a 15-minute HMAC-signed nonce and redirects
 * here. This page collects the user's email address, calls provideEmailAction to
 * update the user row and trigger verification, then navigates to /verify-email.
 *
 * Token validation:
 *   - INVALID_TOKEN → show error card, link back to sign in
 *   - TOKEN_EXPIRED → show expired card, link back to sign in
 *   - Valid → show email form
 *
 * The token is never transmitted except in the initial URL and the server action
 * call (which goes over HTTPS via Next.js Server Action RPC, same-origin only).
 */

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2Icon, MailIcon, AlertCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { provideEmailAction } from "@/app/actions/auth/provide-email";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

type FormValues = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Inner component (reads searchParams)
// ---------------------------------------------------------------------------

function ProvideEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "" },
  });

  // Missing token — show error immediately.
  if (!token) {
    return (
      <div className="flex items-center justify-center py-4 lg:h-screen">
        <Card className="mx-auto w-96">
          <CardHeader className="flex flex-col items-center gap-2 text-center">
            <AlertCircleIcon className="h-10 w-10 text-destructive" aria-hidden="true" />
            <CardTitle className="text-2xl">Invalid link</CardTitle>
            <CardDescription>
              This link is invalid or has expired. Please sign in again to get a new one.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button asChild variant="outline">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  async function onSubmit(data: FormValues) {
    setIsSubmitting(true);
    try {
      const result = await provideEmailAction({ token, email: data.email });

      if (!result.ok) {
        switch (result.code) {
          case "TOKEN_EXPIRED":
          case "INVALID_TOKEN":
            toast.error("This link has expired. Please sign in again.");
            router.push("/login");
            return;
          case "EMAIL_TAKEN":
            form.setError("email", { message: result.message });
            return;
          case "RATE_LIMITED":
            toast.error(result.message);
            return;
          default:
            toast.error(result.message ?? "Something went wrong. Please try again.");
            return;
        }
      }

      // Success — redirect to verify-email so the user confirms ownership.
      router.push(`/verify-email?email=${encodeURIComponent(result.email)}`);
    } catch {
      toast.error("Unable to connect. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <Card className="mx-auto w-96">
        <CardHeader className="flex flex-col items-center gap-2 text-center">
          <MailIcon className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
          <CardTitle className="text-2xl">Add your email address</CardTitle>
          <CardDescription>
            Your GitHub account has a private email. Please provide an email address
            so we can verify your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <Label htmlFor="email">Email address</Label>
                    <FormControl>
                      <Input
                        {...field}
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        autoFocus
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2Icon className="animate-spin" />
                    Please wait
                  </>
                ) : (
                  "Continue"
                )}
              </Button>
            </form>
          </Form>

          <div className="mt-4 text-center text-sm text-muted-foreground">
            <Link
              href="/login"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              Back to sign in
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page export
// ---------------------------------------------------------------------------

export default function ProvideEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-4 lg:h-screen">
          <Loader2Icon className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <ProvideEmailContent />
    </Suspense>
  );
}
