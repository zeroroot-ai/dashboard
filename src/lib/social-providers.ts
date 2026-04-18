/**
 * Social provider configuration builder for Gibson Dashboard.
 *
 * Reads {PROVIDER}_CLIENT_ID / {PROVIDER}_CLIENT_SECRET (and
 * MICROSOFT_TENANT_ID for Entra ID) from the process environment and
 * returns the Better Auth `socialProviders` config map plus the ordered
 * list of enabled provider IDs used by the UI layer.
 *
 * Invariants enforced at import time (throw → dashboard fails to start):
 *  - Partial config: CLIENT_ID set without CLIENT_SECRET (or vice versa)
 *    for any provider is a misconfiguration — named variable surfaced.
 *  - Microsoft requires MICROSOFT_TENANT_ID explicitly when the client
 *    credentials are set; there is NO default (not even "common"). The
 *    operator must make a conscious tenant-model choice.
 *
 * Client secrets are NEVER returned by any export — only the provider
 * configuration objects (which contain clientId but not clientSecret after
 * construction) reach the caller.
 */

import { github } from "better-auth/social-providers";
import { gitlab } from "better-auth/social-providers";
import { google } from "better-auth/social-providers";
import { microsoft } from "better-auth/social-providers";
import type { betterAuth } from "better-auth";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** All provider identifiers supported by this build. */
export type ProviderId = "github" | "gitlab" | "google" | "microsoft";

/** Canonical display order — UI renders buttons in this sequence. */
export const PROVIDER_ORDER: ProviderId[] = ["github", "gitlab", "google", "microsoft"];

export interface SocialProvidersResult {
  /**
   * The `socialProviders` config object to spread into `betterAuth({ … })`.
   * Keys are present only for enabled providers.
   */
  config: NonNullable<Parameters<typeof betterAuth>[0]["socialProviders"]>;
  /**
   * Ordered list of provider IDs that are enabled (have full credentials).
   * Empty array when no social providers are configured.
   */
  enabled: ProviderId[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validate a provider's client ID / secret pair.
 *
 * Returns `null` when neither value is set (provider is disabled — OK).
 * Returns `{ clientId, clientSecret }` when both are set (provider enabled).
 * Throws a startup-blocking Error when exactly one of the pair is present.
 */
function readProviderCredentials(
  provider: string,
  idVar: string,
  secretVar: string,
): { clientId: string; clientSecret: string } | null {
  const clientId = process.env[idVar] ?? "";
  const clientSecret = process.env[secretVar] ?? "";

  const hasId = clientId.length > 0;
  const hasSecret = clientSecret.length > 0;

  if (!hasId && !hasSecret) {
    // Both absent — provider disabled. Not an error.
    return null;
  }

  if (hasId && !hasSecret) {
    throw new Error(
      `[social-providers] ${provider} provider misconfigured: ` +
        `${idVar} is set but ${secretVar} is missing. ` +
        `Set both variables to enable ${provider} sign-in, ` +
        `or unset ${idVar} to disable it entirely.`
    );
  }

  if (!hasId && hasSecret) {
    throw new Error(
      `[social-providers] ${provider} provider misconfigured: ` +
        `${secretVar} is set but ${idVar} is missing. ` +
        `Set both variables to enable ${provider} sign-in, ` +
        `or unset ${secretVar} to disable it entirely.`
    );
  }

  return { clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build the Better Auth `socialProviders` config from environment variables.
 *
 * Throws at module import time when any provider is partially configured —
 * this surfaces as a dashboard startup failure, not a runtime regression.
 *
 * @returns `{ config, enabled }` — spread `config` into `betterAuth({ … })`,
 *   pass `enabled` to the UI layer.
 */
export function buildSocialProviders(): SocialProvidersResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const config: Record<string, any> = {};
  const enabled: ProviderId[] = [];

  // ── GitHub ────────────────────────────────────────────────────────────────
  const gh = readProviderCredentials("GitHub", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET");
  if (gh) {
    config.github = github({ clientId: gh.clientId, clientSecret: gh.clientSecret });
    enabled.push("github");
  }

  // ── GitLab ───────────────────────────────────────────────────────────────
  const gl = readProviderCredentials("GitLab", "GITLAB_CLIENT_ID", "GITLAB_CLIENT_SECRET");
  if (gl) {
    config.gitlab = gitlab({ clientId: gl.clientId, clientSecret: gl.clientSecret });
    enabled.push("gitlab");
  }

  // ── Google ───────────────────────────────────────────────────────────────
  const go = readProviderCredentials("Google", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
  if (go) {
    config.google = google({ clientId: go.clientId, clientSecret: go.clientSecret });
    enabled.push("google");
  }

  // ── Microsoft (Entra ID) ─────────────────────────────────────────────────
  const ms = readProviderCredentials(
    "Microsoft",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET"
  );
  if (ms) {
    const tenantId = process.env.MICROSOFT_TENANT_ID ?? "";
    if (tenantId.length === 0) {
      throw new Error(
        "[social-providers] Microsoft provider requires MICROSOFT_TENANT_ID " +
          "(set to `common`, `organizations`, `consumers`, or a tenant GUID). " +
          "There is no default — you must make an explicit tenant-model choice. " +
          "Set MICROSOFT_TENANT_ID alongside MICROSOFT_CLIENT_ID and " +
          "MICROSOFT_CLIENT_SECRET to enable Microsoft sign-in."
      );
    }
    config.microsoft = microsoft({
      clientId: ms.clientId,
      clientSecret: ms.clientSecret,
      tenantId,
    });
    enabled.push("microsoft");
  }

  return {
    config: config as NonNullable<Parameters<typeof betterAuth>[0]["socialProviders"]>,
    enabled,
  };
}
