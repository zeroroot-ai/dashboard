// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * /signup/complete — step TWO of self-serve signup.
 *
 * Reachable only by following the emailed link, which /signup/verify redeems
 * into a short-lived httpOnly session cookie. Without that cookie there is
 * nothing to complete, so this page sends the visitor back to the start rather
 * than rendering a form that could never succeed.
 *
 * This is where the password is collected and the account is created. That
 * ordering is the entire point of splitting signup across two screens: before
 * the link is opened, an address is just something a stranger typed into a
 * form.
 */

import { redirect } from "next/navigation";
import { cookies } from "next/headers";

import { DEFAULT_PASSWORD_POLICY } from "@/src/lib/zitadel/password-policy-cache";
import { getDeploymentProfile } from "@/src/lib/deployment-profile";
import {
  SIGNUP_VERIFIED_COOKIE,
  decodeVerifiedSession,
  displayOnly,
} from "@/src/lib/signup/verified-session";
import { CompleteSignupForm } from "./complete-form";
import { POST_SIGNUP_REDIRECT } from "../types";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Finish setting up your account",
};

export default async function SignupCompletePage() {
  const jar = await cookies();
  const session = decodeVerifiedSession(jar.get(SIGNUP_VERIFIED_COOKIE)?.value);

  if (session?.spent) {
    // Completion already succeeded in this browser. The account exists. With
    // an external signup step, the step page takes over; otherwise the only
    // thing left to do is sign in (dashboard#79).
    redirect(session.stepLink ? "/signup/step" : POST_SIGNUP_REDIRECT);
  }

  if (!session) {
    // Same destination as every other verification failure. The daemon answers
    // unknown / expired / spent links identically; this page must not become
    // the place where those outcomes are told apart.
    redirect("/signup?verify=invalid");
  }

  const { signupStepText } = getDeploymentProfile();

  return (
    <CompleteSignupForm
      // displayOnly strips the completion token. The client never receives it:
      // it stays in the httpOnly cookie and is read server-side by the actions.
      verified={displayOnly(session)}
      passwordPolicy={DEFAULT_PASSWORD_POLICY}
      stepText={signupStepText}
    />
  );
}
