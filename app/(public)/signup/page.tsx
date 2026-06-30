/**
 * Signup page, Server Component.
 *
 * Validates `?plan=` against the self-serve plan IDs.
 *
 * Plan-missing / plan-invalid behavior depends on the WWW_URL env var
 * (dashboard#917, deploy#1055):
 *   - SaaS (WWW_URL set): redirect to `${WWW_URL}/pricing?missing_plan=true`
 *     so users can choose a plan on the marketing site.
 *   - Self-hosted (WWW_URL unset): default to the first self-serve tier and
 *     render SignupForm in-app. No off-cluster redirect.
 *
 * Seeds the client-side password strength meter with the default password
 * policy. The meter is advisory only; the daemon enforces the authoritative
 * Zitadel policy at user-create time (via the SignupService.Signup RPC), so
 * the dashboard no longer fetches the live policy (E9, dashboard#812 — the
 * privileged signup-bot PAT is retired).
 *
 * Renders `<SignupForm>` inside a Suspense boundary (matching the pattern
 * used by `/login`).
 *
 * Self-hosted / SaaS seam gate (deploy ADR-0006, gibson#1088):
 * When SIGNUP_SELF_SERVE is unset (self-hosted profile), this page is not
 * accessible — redirect to /login so the self-hosted front door is login-only.
 * The env var is read server-side only; it is not exposed to the browser.
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
  // Self-hosted / SaaS seam gate (deploy ADR-0006, gibson#1088).
  // SIGNUP_SELF_SERVE is set by the SaaS overlay (gitops); absent on self-hosted.
  // Self-hosted /signup is never reachable — redirect to login (the front door).
  if (!process.env.SIGNUP_SELF_SERVE) {
    redirect("/login");
  }

  const params = await searchParams;
  const rawPlan = typeof params.plan === "string" ? params.plan : undefined;

  // Validate plan against the self-serve tier list.
  const isValidPlan =
    rawPlan !== undefined &&
    (selfServeTierIds as readonly string[]).includes(rawPlan);

  // WWW_URL is set by the SaaS Helm overlay (gitops) and points to the
  // marketing site (e.g. https://www.zeroroot.ai). On self-hosted it is unset.
  // dashboard#917 / deploy#1055: the pricing redirect is SaaS-only.
  const marketingUrl = process.env.WWW_URL
    ? process.env.WWW_URL.replace(/\/$/, "")
    : null;

  if (!isValidPlan) {
    // TEST_FIXTURES_BYPASS_PRICING: allow e2e tests to skip the plan-validation
    // redirect so the signup form renders even when the test cluster has no
    // plan configuration. NEVER set this in production, it removes the pricing
    // gate entirely for any request to /signup.
    if (process.env.TEST_FIXTURES_BYPASS_PRICING !== "true") {
      if (marketingUrl) {
        // SaaS: bounce to the marketing pricing page so the user can pick a plan.
        redirect(`${marketingUrl}/pricing?missing_plan=true`);
      }
      // Self-hosted (marketingUrl unset): fall through to the form with the
      // first self-serve tier. No off-cluster redirect.
    }
    // In bypass mode (e2e) or self-hosted mode, fall through with the first
    // self-serve plan so the form renders with a valid (if arbitrary) plan.
    const fallbackPlan = selfServeTierIds[0] ?? "solo";
    const fallbackDisplayName =
      process.env.TEST_FIXTURES_BYPASS_PRICING === "true"
        ? "(test bypass)"
        : (pricingDisplays.find((p) => p.id === fallbackPlan)?.name ??
          fallbackPlan);
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-4 lg:h-screen">
            <Loader2Icon className="h-6 w-6 animate-spin" />
          </div>
        }
      >
        <SignupForm
          plan={fallbackPlan}
          planDisplayName={fallbackDisplayName}
          passwordPolicy={DEFAULT_PASSWORD_POLICY}
          publishableKey={process.env.STRIPE_PUBLISHABLE_KEY ?? ""}
          pricingUrl={marketingUrl ? `${marketingUrl}/pricing` : null}
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
        pricingUrl={marketingUrl ? `${marketingUrl}/pricing` : null}
      />
    </Suspense>
  );
}
