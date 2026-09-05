/**
 * /verify-email/confirm, Zitadel handles email verification natively.
 *
 * With Auth.js v5 + Zitadel, verification tokens are consumed by Zitadel
 * before the OIDC token is issued. This page is a placeholder that redirects
 * to the dashboard.
 *
 * TODO(zitadel-envoy-gateway-migration): rewrite for Auth.js, see task 24
 * implementation log. The token-consumption via verifyEmailAction is
 * superseded by Zitadel's verification flow. This page can be removed once
 * any existing verification links in flight expire.
 */

import { redirect } from "next/navigation";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function VerifyEmailConfirmPage(_props: Props) {
  // Zitadel handles email verification, redirect straight to dashboard.
  redirect("/dashboard");
}
