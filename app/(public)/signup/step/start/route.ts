// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * GET /signup/step/start — sends the browser to the external signup step.
 *
 * The step link holds the opaque step token of the daemon (gibson#895). It
 * stays in the signed httpOnly session cookie, so no page script reads it.
 * This route reads it there and answers with a redirect. The completion
 * screen and the retry button of the step page both link here.
 *
 * With no completed session, or a session with no step, the browser goes to
 * /login: the account either exists or the signup must start again.
 */

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import {
  SIGNUP_VERIFIED_COOKIE,
  decodeVerifiedSession,
} from "@/src/lib/signup/verified-session";
import { POST_SIGNUP_REDIRECT } from "../../types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const jar = await cookies();
  const session = decodeVerifiedSession(jar.get(SIGNUP_VERIFIED_COOKIE)?.value);
  const link = session?.spent ? session.stepLink : undefined;
  if (!link || !isHttpUrl(link)) {
    return NextResponse.redirect(new URL(POST_SIGNUP_REDIRECT, request.url));
  }
  return NextResponse.redirect(link);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
