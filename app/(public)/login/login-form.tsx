"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { signInAction } from "@/app/actions/auth/signin";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Captcha } from "@/components/gibson/auth/captcha";
import { SocialProvidersBlock } from "@/src/components/auth/SocialProvidersBlock";
import type { ProviderId } from "@/src/lib/social-providers";

const formSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type FormValues = z.infer<typeof formSchema>;

interface LoginFormProps {
  /** Ordered list of enabled social provider IDs from the server. */
  providers: ProviderId[];
}

export function LoginForm({ providers }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  /**
   * Captcha widget is shown after the first CAPTCHA_REQUIRED response from
   * signInAction (i.e. once the IP has ≥5 recent failures) OR when the user
   * retries after a CAPTCHA_FAILED. Once shown it stays mounted for the rest
   * of the page lifecycle so the user isn't forced to solve it repeatedly.
   */
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | undefined>(
    undefined,
  );

  // Show "workspace ready" toast when redirected from provisioning page
  useEffect(() => {
    const toastParam = searchParams.get("toast");
    if (toastParam === "workspace-ready") {
      toast.success("Your workspace is ready! Please sign in.");
    }
  }, [searchParams]);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // Read callbackUrl once at render time for the redirect after sign-in.
  const callbackUrl = searchParams.get("callbackUrl");

  const onSubmit = async (data: FormValues) => {
    setIsSubmitting(true);
    try {
      const result = await signInAction({
        email: data.email,
        password: data.password,
        captchaToken,
      });
      if (!result.ok) {
        // CAPTCHA_REQUIRED / CAPTCHA_FAILED toggle the widget on; burn the
        // currently-held token so the user must re-solve.
        if (
          "code" in result &&
          (result.code === "CAPTCHA_REQUIRED" ||
            result.code === "CAPTCHA_FAILED")
        ) {
          setCaptchaRequired(true);
          setCaptchaToken(undefined);
        }
        toast.error(result.message);
        return;
      }
      // Respect callbackUrl if present and same-origin (starts with '/').
      const target =
        callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : result.redirectTo;
      router.push(target);
    } catch {
      toast.error("Unable to connect. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center py-4 lg:h-screen">
      <Card className="mx-auto w-96">
        <CardHeader>
          <CardTitle className="text-2xl">Login</CardTitle>
          <CardDescription>Enter your email below to login to your account</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Social sign-in buttons — renders nothing when no providers are enabled */}
          <SocialProvidersBlock
            providers={providers}
            redirectTo={callbackUrl && callbackUrl.startsWith("/") ? callbackUrl : undefined}
            mode="signin"
          />

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <Label htmlFor="email">Email</Label>
                    <FormControl>
                      <Input
                        {...field}
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="davinci@ellingsonmineral.com"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem className="grid gap-2">
                    <div className="flex items-center">
                      <Label htmlFor="password">Password</Label>
                      <Link
                        href="/forgot-password"
                        className="ml-auto inline-block text-sm underline"
                      >
                        Forgot your password?
                      </Link>
                    </div>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          id="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          className="pr-10"
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
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* CAPTCHA widget — only rendered after the server signals
                  CAPTCHA_REQUIRED or after a CAPTCHA_FAILED retry. Renders
                  null in disabled/unset provider mode regardless. */}
              {captchaRequired && (
                <Captcha
                  action="signin"
                  onToken={(token) => setCaptchaToken(token)}
                />
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2Icon className="animate-spin" />
                    Please wait
                  </>
                ) : (
                  "Login"
                )}
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm">
            Don&apos;t have an account?{" "}
            <Link href="/pricing" className="underline">
              Sign up
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
