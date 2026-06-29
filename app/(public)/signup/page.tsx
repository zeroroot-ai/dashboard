/**
 * Signup page, Server Component.
 *
 * Validates `?plan=` against the self-serve plan IDs. Redirects to
 * `/pricing?missing_plan=true` when the param is absent or invalid.
 *
 * Seeds the client-side password strength meter with the default password
 * policy. The meter is advisory only; the daemon enforces the authoritative
 * Zitadel policy at user-create time (via the SignupService.Signup RPC), so
 * the dashboard no longer fetches the live policy (E9, dashboard#812 — the
 * privileged signup-bot PAT is retired).
 *
 * Renders `<SignupForm>` inside a Suspense boundary (matching the pattern
 * used by `/login`).
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import type { Metadata } from "next";

import { selfServeTierIds, pricingDisplays } from "@/src/lib/pricing-display";
import { DEFAULT_PASSWORD_POLICY } from "@/src/lib/zitadel/password-policy-cache";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create account | Gibson",
  description: "Sign up for Gibson and start building autonomous AI agents.",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SignupPageProps {
  // Next.js 15 App Router: searchParams is a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SignupPage({ searchParams }: SignupPageProps) {
  const params = await searchParams;
  const rawPlan = typeof params.plan === "string" ? params.plan : undefined;

  // Validate plan against the self-serve tier list.
  const isValidPlan =
    rawPlan !== undefined &&
    (selfServeTierIds as readonly string[]).includes(rawPlan);

  if (!isValidPlan) {
    // TEST_FIXTURES_BYPASS_PRICING: allow e2e tests to skip the plan-validation
    // redirect so the signup form renders even when the test cluster has no
    // plan configuration. NEVER set this in production, it removes the pricing
    // gate entirely for any request to /signup.
    // ADR-0006 / deploy#1033: the pricing page moved to www.zeroroot.ai.
    if (process.env.TEST_FIXTURES_BYPASS_PRICING !== "true") {
      redirect("https://www.zeroroot.ai/pricing?missing_plan=true");
    }
    // In bypass mode, fall through with the first self-serve plan so the form
    // renders with a valid (if arbitrary) plan value.
    const bypassPlan = selfServeTierIds[0] ?? "solo";
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-4 lg:h-screen">
            <Loader2Icon className="h-6 w-6 animate-spin" />
          </div>
        }
      >
        <SignupForm
          plan={bypassPlan}
          planDisplayName="(test bypass)"
          passwordPolicy={DEFAULT_PASSWORD_POLICY}
          publishableKey={process.env.STRIPE_PUBLISHABLE_KEY ?? ""}
        />
      </Suspense>
    );
  }

  // At this point rawPlan is guaranteed non-null and valid.
  const plan = rawPlan as string;

  // Resolve the human-readable plan name for the read-only tier display.
  const planDisplay = pricingDisplays.find((p) => p.id === plan);
  const planDisplayName = planDisplay?.name ?? plan;

  // Seed the client-side strength meter with the default policy. The daemon
  // enforces the authoritative policy at user-create time (E9, dashboard#812).
  const passwordPolicy = DEFAULT_PASSWORD_POLICY;

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-4 lg:h-screen">
          <Loader2Icon className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <SignupForm
        plan={plan}
        planDisplayName={planDisplayName}
        passwordPolicy={passwordPolicy}
        publishableKey={process.env.STRIPE_PUBLISHABLE_KEY ?? ""}
      />
    </Suspense>
  );
}
