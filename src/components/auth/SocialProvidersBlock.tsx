"use client";

/**
 * SocialProvidersBlock
 *
 * Presentational client component rendered above the email+password form on
 * the sign-in and sign-up pages. Shows one button per enabled provider in
 * canonical order (GitHub → GitLab → Google → Microsoft). Returns null when
 * the `providers` list is empty so the parent page is visually unchanged when
 * no social providers are configured.
 *
 * On click: calls signInSocialAction and navigates to the returned URL.
 * On error: surfaces a toast with the error message.
 *
 * Props:
 *  - providers: ProviderId[] — ordered list from buildSocialProviders().enabled
 *  - redirectTo?: string — optional post-auth destination (validated server-side)
 *  - mode: "signin" | "signup" — controls button label prefix
 *
 * No data fetching inside this component — all data is passed as props.
 * No useEffect for analytics — audit happens server-side via signInSocialAction.
 */

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

import { signInSocialAction } from "@/app/actions/auth/signin-social";
import type { ProviderId } from "@/src/lib/social-providers";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

interface ProviderMeta {
  label: string;
  Icon: React.FC<React.SVGProps<SVGSVGElement>>;
}

// SVG icons are inlined to avoid remote fetches and to comply with each
// provider's brand guidelines (official monochrome SVGs from press kits).

const GitHubIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.387.6.113.82-.258.82-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.744.083-.729.083-.729 1.205.084 1.84 1.236 1.84 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.305-5.467-1.334-5.467-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.3 1.23a11.51 11.51 0 0 1 3.003-.404c1.02.005 2.047.138 3.003.404 2.29-1.552 3.296-1.23 3.296-1.23.654 1.652.243 2.873.12 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.815 1.102.815 2.222v3.293c0 .322.218.694.825.576C20.565 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
  </svg>
);

const GitLabIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.92z" />
  </svg>
);

const GoogleIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z" />
  </svg>
);

const MicrosoftIcon: React.FC<React.SVGProps<SVGSVGElement>> = (props) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zM24 11.4H12.6V0H24v11.4z" />
  </svg>
);

const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  github: { label: "GitHub", Icon: GitHubIcon },
  gitlab: { label: "GitLab", Icon: GitLabIcon },
  google: { label: "Google", Icon: GoogleIcon },
  microsoft: { label: "Microsoft", Icon: MicrosoftIcon },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface SocialProvidersBlockProps {
  /** Ordered list of enabled provider IDs — empty renders nothing. */
  providers: ProviderId[];
  /** Optional post-auth redirect destination, validated server-side. */
  redirectTo?: string;
  /** Controls the button label: "Continue with" vs "Sign up with". */
  mode: "signin" | "signup";
}

export function SocialProvidersBlock({
  providers,
  redirectTo,
  mode,
}: SocialProvidersBlockProps) {
  const [pendingProvider, setPendingProvider] = useState<ProviderId | null>(null);

  // Render nothing when no providers are enabled.
  if (!providers || providers.length === 0) return null;

  const labelPrefix = mode === "signup" ? "Sign up with" : "Continue with";

  async function handleClick(provider: ProviderId) {
    if (pendingProvider) return; // debounce while a redirect is in flight
    setPendingProvider(provider);
    try {
      const result = await signInSocialAction({ provider, redirectTo });
      if (result.ok) {
        window.location.assign(result.url);
        // Leave pendingProvider set — the page is navigating away.
        return;
      }
      toast.error(result.message ?? "Sign-in failed. Please try again.");
    } catch {
      toast.error("Unable to connect. Please try again.");
    } finally {
      // Reset only on failure paths; success navigates away.
      setPendingProvider((cur) => (cur === provider ? null : cur));
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {providers.map((provider) => {
        const meta = PROVIDER_META[provider];
        if (!meta) return null;
        const { label, Icon } = meta;
        const isPending = pendingProvider === provider;

        return (
          <Button
            key={provider}
            type="button"
            variant="outline"
            className="w-full gap-2"
            disabled={pendingProvider !== null}
            onClick={() => handleClick(provider)}
            aria-label={`${labelPrefix} ${label}`}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Icon className="h-4 w-4" />
            )}
            <span>
              {labelPrefix} {label}
            </span>
          </Button>
        );
      })}

      {/* Horizontal divider — only rendered when there are provider buttons above. */}
      <div className="relative my-2">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">or</span>
        </div>
      </div>
    </div>
  );
}
