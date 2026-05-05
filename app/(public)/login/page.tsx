/**
 * Login page — Server Component.
 *
 * Reads the list of enabled social providers server-side (via buildSocialProviders)
 * so that no provider client IDs are leaked beyond what is strictly necessary,
 * and no disabled providers are rendered. Passes the list to the client-side
 * LoginForm, which renders SocialProvidersBlock above the email/password form.
 */

import { Suspense } from "react";
import { Loader2Icon } from "lucide-react";
import { buildSocialProviders, PROVIDER_ORDER } from "@/src/lib/social-providers";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  // buildSocialProviders() throws at startup if any provider has a partial
  // config, so by the time this render runs either everything is valid or
  // the process has already crashed. We only pass the enabled IDs to the
  // client — client secrets stay server-only.
  const { enabled } = buildSocialProviders();

  // UI preview toggle: when DASHBOARD_SOCIAL_PREVIEW=true, render every
  // supported provider button regardless of backend wiring so operators can
  // see the layout before real OAuth credentials are plumbed in. Clicking a
  // non-configured button surfaces Auth.js's "provider not found" error
  // — acceptable for preview, not for production.
  const previewAll = process.env.DASHBOARD_SOCIAL_PREVIEW === "true";
  const providers = previewAll ? PROVIDER_ORDER : enabled;

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-4 lg:h-screen">
          <Loader2Icon className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <LoginForm providers={providers} />
    </Suspense>
  );
}
