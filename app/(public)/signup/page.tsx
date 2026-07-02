/**
 * Signup page, Server Component.
 *
 * Validates `?plan=` against the self-serve plan IDs.
 *
 * Plan-missing / plan-invalid behavior depends on the deployment profile
 * (resolved via getDeploymentProfile(), dashboard#921):
 *   - SaaS (billingEnabled=true, marketingUrl set): redirect to
 *     `${marketingUrl}/pricing?missing_plan=true` so users can choose a plan
 *     on the marketing site.
 *   - Self-hosted (billingEnabled=false, marketingUrl null): no `?plan=`
 *     required and no off-cluster redirect. Plans are a SaaS concept; self-
 *     hosted runs unlimited-metered entitlements. Default to the first self-
 *     serve tier internally (for the daemon wire) but hide the plan row from
 *     the form entirely. dashboard#923 / PRD dashboard#920.
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
import { getDeploymentProfile } from "@/src/lib/deployment-profile";
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
  // Resolve the deployment posture from the single source of truth.
  // dashboard#921 / PRD dashboard#920 / deploy ADR-0006.
  const profile = getDeploymentProfile();

  // Self-hosted / SaaS seam gate (deploy ADR-0006, gibson#1088).
  // When selfServeSignup is false, /signup is never reachable — redirect to
  // login (the front door). Derived from SIGNUP_SELF_SERVE via the resolver.
  if (!profile.selfServeSignup) {
    redirect("/login");
  }

  const params = await searchParams;
  const rawPlan = typeof params.plan === "string" ? params.plan : undefined;

  // Validate plan against the self-serve tier list.
  const isValidPlan =
    rawPlan !== undefined &&
    (selfServeTierIds as readonly string[]).includes(rawPlan);

  // marketingUrl is null on self-hosted (WWW_URL unset) and non-null on SaaS.
  // dashboard#917 / deploy#1055: the pricing redirect is SaaS-only.
  // dashboard#921: resolved via the deployment-profile resolver (single reader).
  const { marketingUrl, billingEnabled } = profile;

  if (!isValidPlan) {
    // TEST_FIXTURES_BYPASS_PRICING: allow e2e tests to skip the plan-validation
    // redirect so the signup form renders even when the test cluster has no
    // plan configuration. NEVER set this in production, it removes the pricing
    // gate entirely for any request to /signup.
    if (process.env.TEST_FIXTURES_BYPASS_PRICING !== "true") {
      if (billingEnabled && marketingUrl) {
        // SaaS: bounce to the marketing pricing page so the user can pick a plan.
        // Self-hosted (billingEnabled=false): no ?plan= required — plans are a
        // SaaS concept; fall through to the card-free form. dashboard#923.
        redirect(`${marketingUrl}/pricing?missing_plan=true`);
      }
      // Self-hosted (billingEnabled=false, marketingUrl null): fall through to
      // the form with the first self-serve tier used for the daemon wire.
      // The plan row is hidden from the user entirely (dashboard#923).
    }
    // In bypass mode (e2e), self-hosted mode, or card-free profile: fall through
    // with the first self-serve plan so the daemon wire receives a valid tier.
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
          billingEnabled={billingEnabled}
          termsUrl={marketingUrl ? `${marketingUrl}/terms` : null}
          privacyUrl={marketingUrl ? `${marketingUrl}/privacy` : null}
        />
      </Suspense>
    );
  }

  // At this point rawPlan is guaranteed non-null and valid (SaaS path: billingEnabled=true
  // and marketingUrl set so the redirect above ran, or billingEnabled=false where
  // we fell through above with the fallback).
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
        billingEnabled={billingEnabled}
        termsUrl={marketingUrl ? `${marketingUrl}/terms` : null}
        privacyUrl={marketingUrl ? `${marketingUrl}/privacy` : null}
      />
    </Suspense>
  );
}
