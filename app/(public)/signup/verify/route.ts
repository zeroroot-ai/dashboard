/**
 * GET /signup/verify?token=… — the target of the emailed verification link.
 *
 * This is the route the daemon builds that link against
 * (`SignupVerifyPath` in gibson's signup_wiring.go). If the two ever disagree
 * the whole self-serve flow dead-ends at a 404, so treat the path as a
 * contract, not an implementation detail.
 *
 * A Route Handler rather than a page, for two reasons:
 *
 *   1. It has to set a cookie. Redemption is single-use, so its result must be
 *      captured somewhere the completion step can read it, and a Server
 *      Component render cannot write cookies.
 *   2. It redirects immediately, which takes the raw token out of the address
 *      bar. The token is spent by then, but leaving it in history, in the
 *      Referer of every subsequent request, and in any screenshot the user
 *      takes is avoidable.
 *
 * NOTHING billable happens here. The billing customer and the SetupIntent are
 * created by the completion page, strictly after this redemption succeeded —
 * that ordering is the reason this route exists at all.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { redeemSignupVerification } from '@/src/lib/signup/owner-provisioning';
import { clientIpFromHeaders } from '@/src/lib/signup/client-ip';
import {
  SIGNUP_VERIFIED_COOKIE,
  SIGNUP_VERIFIED_MAX_AGE_SECONDS,
  encodeVerifiedSession,
  signupCookieOptions,
  verifiedSessionFrom,
} from '@/src/lib/signup/verified-session';
import { logger } from '@/src/lib/logger';

/**
 * Where a link that does not work sends the user.
 *
 * ONE destination for every failure — absent token, unknown token, expired
 * token, already-redeemed token, daemon unreachable. The daemon deliberately
 * answers all of those identically so redemption cannot be used to probe which
 * signups exist; distinguishing them here would hand that oracle back.
 */
const VERIFY_FAILED_REDIRECT = '/signup?verify=invalid';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const clientIp = clientIpFromHeaders({
    forwardedFor: req.headers.get('x-forwarded-for'),
    realIp: req.headers.get('x-real-ip'),
  });

  if (!token) {
    return NextResponse.redirect(new URL(VERIFY_FAILED_REDIRECT, req.nextUrl));
  }

  let session;
  try {
    session = verifiedSessionFrom(
      await redeemSignupVerification({ token, clientIp }),
    );
  } catch (err) {
    // Never log the token, and never surface which kind of failure this was.
    logger.warn(
      { action: 'signup_verify_redeem', err: err instanceof Error ? err.message : String(err) },
      'signup verification redemption failed',
    );
    return NextResponse.redirect(new URL(VERIFY_FAILED_REDIRECT, req.nextUrl));
  }

  const res = NextResponse.redirect(new URL('/signup/complete', req.nextUrl));
  res.cookies.set({
    name: SIGNUP_VERIFIED_COOKIE,
    value: encodeVerifiedSession(session),
    maxAge: SIGNUP_VERIFIED_MAX_AGE_SECONDS,
    ...signupCookieOptions(),
  });
  return res;
}
