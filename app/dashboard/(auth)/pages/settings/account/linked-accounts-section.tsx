/**
 * LinkedAccountsSection — Server Component
 *
 * Fetches the current user's linked accounts from Better Auth's API and renders
 * a list showing which social providers are connected. Each row has a Link or
 * Unlink button (client component) that calls the corresponding server action.
 *
 * The component:
 *  - Shows only providers that are currently enabled in the deployment.
 *  - Marks the Unlink button as disabled when it would be the last credential.
 *  - Gracefully renders nothing when no social providers are enabled.
 */

import { headers } from "next/headers";

import { auth } from "@/src/lib/auth-server";
import { buildSocialProviders, PROVIDER_ORDER } from "@/src/lib/social-providers";
import type { ProviderId } from "@/src/lib/social-providers";
import { countSignInMethods } from "@/src/lib/auth/count-signin-methods";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkedAccountsButtons } from "./linked-accounts-buttons";

// ---------------------------------------------------------------------------
// Provider display metadata
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<ProviderId, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  google: "Google",
  microsoft: "Microsoft 365",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export async function LinkedAccountsSection() {
  const { enabled } = buildSocialProviders();

  // If no providers are configured, render nothing — the page is visually
  // unchanged from the pre-social era.
  if (enabled.length === 0) return null;

  // Fetch the user's accounts. The server component calls auth.api directly
  // using the current request's headers (which contain the session cookie).
  const reqHeaders = await headers();
  let linkedProviderIds: Set<string> = new Set();
  let totalMethods = 0;

  try {
    const accounts = await auth.api.listUserAccounts({ headers: reqHeaders });
    const accountList = Array.isArray(accounts) ? accounts : [];
    linkedProviderIds = new Set(accountList.map((a) => a.providerId));
    totalMethods = countSignInMethods(accountList);
  } catch {
    // If we can't fetch accounts, fall through and render all providers as
    // not-linked. The user can still navigate away; the buttons will show
    // actual errors on click.
  }

  // Render providers in canonical order (same as SocialProvidersBlock) but
  // only those enabled in this deployment.
  const orderedEnabled = PROVIDER_ORDER.filter((p) => enabled.includes(p));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked Accounts</CardTitle>
        <CardDescription>
          Connect social accounts to sign in without a password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border" role="list" aria-label="Linked accounts">
          {orderedEnabled.map((provider) => {
            const isLinked = linkedProviderIds.has(provider);
            // Unlink button is disabled when this is the user's only credential.
            const isLastCredential = isLinked && totalMethods <= 1;

            return (
              <li
                key={provider}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
              >
                <span className="text-sm font-medium">{PROVIDER_LABELS[provider]}</span>
                <div className="flex items-center gap-3">
                  {isLinked && (
                    <span className="text-xs text-muted-foreground">Connected</span>
                  )}
                  <LinkedAccountsButtons
                    provider={provider}
                    isLinked={isLinked}
                    isLastCredential={isLastCredential}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
