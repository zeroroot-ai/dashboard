// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * /signup/step — the browser returns here from the external signup step.
 *
 * The page waits until the daemon reports the step done, then waits for the
 * workspace and sends the browser to /login. On a failed step it shows the
 * failure text and a retry button. All texts come from config
 * (`DASHBOARD_SIGNUP_STEP_*`); the source holds no default for them.
 *
 * The attempt id, the step link and the tenant slug stay in the signed
 * httpOnly session cookie. With no completed session that holds a step, there
 * is nothing to wait for, so the page sends the browser to /login.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDeploymentProfile } from "@/src/lib/deployment-profile";
import {
  SIGNUP_VERIFIED_COOKIE,
  decodeVerifiedSession,
} from "@/src/lib/signup/verified-session";
import { POST_SIGNUP_REDIRECT } from "../types";
import { SignupStepWaiting } from "./step-waiting";

export const dynamic = "force-dynamic";

export default async function SignupStepPage() {
  const jar = await cookies();
  const session = decodeVerifiedSession(jar.get(SIGNUP_VERIFIED_COOKIE)?.value);
  const { signupStepText } = getDeploymentProfile();

  if (!session?.spent || !session.stepLink || !signupStepText) {
    redirect(POST_SIGNUP_REDIRECT);
  }

  return (
    <SignupStepWaiting attemptId={session.attemptId} stepText={signupStepText} />
  );
}
