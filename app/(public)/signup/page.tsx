/**
 * Sign-up page — Server Component.
 *
 * Reads the list of enabled social providers server-side (via buildSocialProviders)
 * so that no provider client IDs are leaked beyond what is strictly necessary,
 * and no disabled providers are rendered. Passes the list to the client-side
 * SignupForm, which renders SocialProvidersBlock above the registration fields.
 */

import { buildSocialProviders } from "@/src/lib/social-providers";
import { SignupForm } from "./signup-form";

export default function SignupPage() {
  // buildSocialProviders() throws at startup if any provider has a partial
  // config, so by the time this render runs either everything is valid or
  // the process has already crashed. We only pass the enabled IDs to the
  // client — client secrets stay server-only.
  const { enabled } = buildSocialProviders();

  return <SignupForm providers={enabled} />;
}
