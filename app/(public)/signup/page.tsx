/**
 * Signup page — Server Component.
 *
 * Validates `?plan=` against the self-serve plan IDs. Redirects to
 * `/pricing?missing_plan=true` when the param is absent or invalid.
 *
 * Fetches the Zitadel password-complexity policy server-side via the
 * cached helper so the client-side strength meter starts with the correct
 * requirements. Falls back to `DEFAULT_PASSWORD_POLICY` on Zitadel outage
 * — the form still renders.
 *
 * Renders `<SignupForm>` inside a Suspense boundary (matching the pattern
 * used by `/login`).
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import type { Metadata } from "next";

import { selfServeTierIds, pricingDisplays } from "@/src/lib/pricing-display";
import { getCachedPasswordPolicy, DEFAULT_PASSWORD_POLICY } from "@/src/lib/zitadel/password-policy-cache";
import { getSignupZitadelAdminClient } from "@/src/lib/zitadel/admin-client-factory";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = {
  title: "Create account — Gibson",
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
    // plan configuration. NEVER set this in production — it removes the pricing
    // gate entirely for any request to /signup.
    if (process.env.TEST_FIXTURES_BYPASS_PRICING !== "true") {
      redirect("/pricing?missing_plan=true");
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
        />
      </Suspense>
    );
  }

  // At this point rawPlan is guaranteed non-null and valid.
  const plan = rawPlan as string;

  // Resolve the human-readable plan name for the read-only tier display.
  const planDisplay = pricingDisplays.find((p) => p.id === plan);
  const planDisplayName = planDisplay?.name ?? plan;

  // Fetch the password policy server-side. Never throws — falls back to defaults.
  let passwordPolicy = DEFAULT_PASSWORD_POLICY;
  try {
    const client = getSignupZitadelAdminClient();
    passwordPolicy = await getCachedPasswordPolicy(client);
  } catch {
    // Factory throws if env vars are missing (dev without chart, unit tests).
    // Fall back to the default policy so the form still renders.
    console.warn(
      "[signup/page] Could not initialise Zitadel admin client; using default password policy.",
    );
  }

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
      />
    </Suspense>
  );
}
