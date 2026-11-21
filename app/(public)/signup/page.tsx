// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Signup page, Server Component.
 *
 * There is one plan, so the page takes no `?plan=` and shows no plan choice.
 * The daemon puts every signup on the one plan.
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

import { getDeploymentProfile } from "@/src/lib/deployment-profile";
import { SignupForm } from "./signup-form";
import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Create account | Gibson",
  description: "Sign up for Gibson and start building autonomous AI agents.",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function SignupPage() {
  // Resolve the deployment posture from the single source of truth.
  // dashboard#921 / PRD dashboard#920 / ADR-0074.
  const profile = getDeploymentProfile();

  // Registration rung gate (ADR-0074, gibson#1088). On the closed rung
  // /signup is never reachable: redirect to login (the front door).
  if (profile.signupRung === "closed") {
    redirect("/login");
  }

  // The approval rung (dashboard#267): one form, sent to Register.
  if (profile.signupRung === "approval") {
    return <RegisterForm />;
  }

  // marketingUrl is null on self-hosted (WWW_URL unset) and non-null on SaaS.
  const { marketingUrl } = profile;

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-4 lg:h-screen">
          <Loader2Icon className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <SignupForm
        termsUrl={marketingUrl ? `${marketingUrl}/terms` : null}
        privacyUrl={marketingUrl ? `${marketingUrl}/privacy` : null}
      />
    </Suspense>
  );
}
