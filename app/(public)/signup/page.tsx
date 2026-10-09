// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Signup page, Server Component.
 *
 * Validates `?plan=` against the self-serve plan IDs.
 *
 * Plan-missing / plan-invalid behavior depends on the deployment profile
 * (resolved via getDeploymentProfile(), dashboard#921):
 *   - SaaS (marketingUrl set): redirect to
 *     `${marketingUrl}/pricing?missing_plan=true` so users can choose a plan
 *     on the marketing site.
 *   - Self-hosted (marketingUrl null): no `?plan=`
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
 * Registration rung gate (ADR-0074, gibson#1088, dashboard#267):
 *   - closed (SIGNUP_SELF_SERVE unset): redirect to /login, so the front door
 *     is login-only.
 *   - approval: render <RegisterForm>, which sends the whole form to
 *     SignupService.Register. An administrator approves the registration.
 *   - open: the self-serve flow below.
 * The env var is read server-side only; it is not exposed to the browser.
 */

import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import type { Metadata } from "next";

import { selfServeTierIds, pricingDisplays } from "@/src/lib/pricing-display";
import { getDeploymentProfile } from "@/src/lib/deployment-profile";
import { SignupForm } from "./signup-form";
import { RegisterForm } from "./register-form";

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
  // dashboard#921 / PRD dashboard#920 / ADR-0074.
  const profile = getDeploymentProfile();

  // Registration rung gate (ADR-0074, gibson#1088). On the closed rung
  // /signup is never reachable: redirect to login (the front door).
  if (profile.signupRung === "closed") {
    redirect("/login");
  }

  // The approval rung (dashboard#267): one form, sent to Register. Plans are a
  // SaaS concept, so the daemon gets the first self-serve tier.
  if (profile.signupRung === "approval") {
    return <RegisterForm tier={selfServeTierIds[0] ?? "solo"} />;
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
  const { marketingUrl } = profile;
  const showPlan = marketingUrl !== null;

  if (!isValidPlan) {
    if (marketingUrl) {
      // SaaS: bounce to the marketing pricing page so the user can pick a plan.
      // Self-hosted: no ?plan= required. Plans are a SaaS concept; fall
      // through to the form. dashboard#923.
      redirect(`${marketingUrl}/pricing?missing_plan=true`);
    }
    // Self-hosted (marketingUrl null): fall through to
    // the form with the first self-serve tier used for the daemon wire.
    // The plan row is hidden from the user entirely (dashboard#923).
    const fallbackPlan = selfServeTierIds[0] ?? "solo";
    const fallbackDisplayName =
      pricingDisplays.find((p) => p.id === fallbackPlan)?.name ?? fallbackPlan;
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
          pricingUrl={marketingUrl ? `${marketingUrl}/pricing` : null}
          showPlan={showPlan}
          termsUrl={marketingUrl ? `${marketingUrl}/terms` : null}
          privacyUrl={marketingUrl ? `${marketingUrl}/privacy` : null}
        />
      </Suspense>
    );
  }

  // At this point rawPlan is guaranteed non-null and valid: an invalid plan
  // either redirected (SaaS) or returned the fallback form above (self-hosted).
  const plan = rawPlan as string;

  // Resolve the human-readable plan name for the read-only tier display.
  const planDisplay = pricingDisplays.find((p) => p.id === plan);
  const planDisplayName = planDisplay?.name ?? plan;

  // Seed the client-side strength meter with the default policy. The daemon
  // enforces the authoritative policy at user-create time (E9, dashboard#812).

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
        pricingUrl={marketingUrl ? `${marketingUrl}/pricing` : null}
        showPlan={showPlan}
        termsUrl={marketingUrl ? `${marketingUrl}/terms` : null}
        privacyUrl={marketingUrl ? `${marketingUrl}/privacy` : null}
      />
    </Suspense>
  );
}
