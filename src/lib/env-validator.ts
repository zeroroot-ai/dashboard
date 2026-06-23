/**
 * Boot-time required-env validation for the dashboard.
 *
 * Spec: one-code-path (deploy#186), slice deploy#206.
 *
 * This module enumerates every environment variable the dashboard requires
 * to operate. `validateEnv()` is called once at process boot by
 * `instrumentation.ts`; missing keys cause the Next.js Node server to
 * crash before it accepts any traffic (kubelet then reports
 * `CrashLoopBackOff`, which is the desired fail-fast signal).
 *
 * Per the one-code-path doctrine ("fail at boot, never skip silently"),
 * required config has NO runtime fallback. Genuinely optional config is
 * typed as `string | undefined` and listed below in the OPTIONAL block
 * with a one-line justification for why it can be absent.
 *
 * Build-time vs runtime split:
 *   `next.config.ts` is evaluated at `next build` time (and again at
 *   server start), the only env var it reads, `GIBSON_API_URL`, is a
 *   build-time concern. We surface it through `env.GIBSON_API_URL` so
 *   `next.config.ts` no longer carries an inline `?? "http://localhost"`
 *   fallback, AND we add a build-time check script
 *   (`scripts/check-required-build-env.mjs`) that runs before `next build`
 *   on the production codepath so a missing `GIBSON_API_URL` fails the
 *   image build, not just the pod boot. See the prebuild chain.
 *
 * Calling pattern from instrumentation.ts:
 *
 *   import { validateEnv } from '@/src/lib/env-validator';
 *   validateEnv(); // throws EnvValidationError on missing required keys
 *
 * Calling pattern from anywhere else (do NOT use `process.env.X` for
 * required keys, use the typed accessor):
 *
 *   import { env } from '@/src/lib/env-validator';
 *   const issuer = env.ZITADEL_ISSUER;   // string (validated)
 *   const langfuse = env.LANGFUSE_HOST;  // string | undefined (optional)
 */

// ---------------------------------------------------------------------------
// Spec descriptors
// ---------------------------------------------------------------------------

/** What shape a required env var must take. */
export type EnvKind = 'string' | 'url' | 'boolean' | 'number';

/**
 * Single required-env entry.
 *
 * - `name` , the env var name (matches `process.env[name]`).
 * - `kind` , type contract; used to validate shape (not just presence).
 * - `hint` , one-line operator hint. Surfaced verbatim in the failure log.
 * - `proddOnly`, when true, the var is only required when NODE_ENV === 'production'.
 *               Dev/local boots without it. Use sparingly, most things should
 *               be required everywhere so dev parity is structural.
 */
export interface RequiredEnvSpec {
  name: string;
  kind: EnvKind;
  hint: string;
  /** Default false; if true, only enforced in `NODE_ENV === 'production'`. */
  prodOnly?: boolean;
}

/**
 * The canonical required-env table.
 *
 * Adding a new entry here is the ONLY way to make a new env var "required."
 * Inline `process.env.X ?? "default"` patterns are forbidden, they are
 * silent footguns and break the one-code-path invariant.
 *
 * If a callsite legitimately tolerates absence (e.g. it tries multiple email
 * provider channels), add the key to OPTIONAL_ENV (below) with a justification.
 */
export const REQUIRED_ENV: readonly RequiredEnvSpec[] = [
  // ---- Identity (Zitadel) ----
  {
    name: 'ZITADEL_ISSUER',
    kind: 'url',
    hint:
      'Zitadel OIDC issuer URL the browser sees (e.g. https://auth.zeroroot.local:30443). ' +
      'Auth.js uses this for authorize redirects + iss-claim validation.',
  },
  {
    name: 'ZITADEL_CLIENT_ID',
    kind: 'string',
    hint:
      'OIDC client_id of the gibson-dashboard application registered in Zitadel. ' +
      "Mounted by Helm from the `gibson-dashboard-oidc` secret's `client_id` key.",
  },
  {
    name: 'ZITADEL_CLIENT_SECRET',
    kind: 'string',
    hint:
      'OIDC client_secret for the dashboard. Confidential client per ' +
      'one-code-path/196; PKCE-public-client variant retired.',
  },
  {
    name: 'ZITADEL_AUDIENCE',
    kind: 'string',
    hint:
      'Expected `aud` claim on machine-to-machine JWTs hitting service-acting routes. ' +
      'Production value: "gibson-platform". Set explicitly; no default.',
  },
  {
    name: 'ALLOWED_SERVICE_SUBJECTS',
    kind: 'string',
    hint:
      'Comma-separated NUMERIC Zitadel subs allowed to call service-acting routes. ' +
      'Populated by the chart\'s resolve-sa-identity-map init container at pod start.',
    // Only enforced in production: local `pnpm dev` and `pnpm build` static
    // analysis do not exercise inbound service-acting traffic. Matches the
    // existing `assertAllowedServiceSubjectsConfigured()` gate at instrumentation.
    prodOnly: true,
  },

  // ---- Auth.js ----
  {
    name: 'AUTH_SECRET',
    kind: 'string',
    hint:
      'Random 32+ char secret used by Auth.js to encrypt JWE cookies and ' +
      'HMAC the missing-email-recovery nonce. Generate with `openssl rand -base64 32`.',
  },
  {
    name: 'AUTH_URL',
    kind: 'url',
    hint:
      'Public dashboard URL Auth.js uses for OIDC callback construction. ' +
      'e.g. https://app.zeroroot.local:30443 (kind) or https://app.zeroroot.ai (prod).',
  },
  {
    name: 'POST_LOGOUT_REDIRECT_URI',
    kind: 'url',
    hint:
      'Exact URI Zitadel has registered as a post_logout_redirect_uri for the ' +
      'dashboard OIDC client. RP-initiated logout sends this verbatim; a mismatch ' +
      'makes Zitadel reject the logout with invalid_request.',
  },

  // ---- Daemon front door (Envoy) ----
  {
    name: 'GIBSON_PLATFORM_PUBLIC_URL',
    kind: 'url',
    hint:
      'Envoy ingress URL operators use to reach the platform API ' +
      '(e.g. https://api.zeroroot.local:30443). Used for user-facing links.',
  },
  {
    name: 'GIBSON_PUBLIC_URL',
    kind: 'url',
    hint:
      'Public Envoy URL surfaced to agents/tools/plugins via /api/config/public ' +
      '(matches GIBSON_PLATFORM_PUBLIC_URL in practice; surface kept for the wizard).',
  },
  {
    name: 'GIBSON_API_URL',
    kind: 'url',
    hint:
      'Internal Envoy gRPC endpoint the Next.js rewrite at /api/grpc forwards to ' +
      '(e.g. http://gibson-envoy:30443). Read by next.config.ts at build time AND ' +
      'startup, check-required-build-env.mjs enforces this in CI too.',
  },
  {
    name: 'PUBLIC_URL',
    kind: 'url',
    hint:
      'Public base URL of the dashboard (matches AUTH_URL in single-origin deploys). ' +
      'Used for Stripe checkout return_url, billing-portal success_url, transactional emails.',
  },

  // ---- Stores ----
  {
    name: 'DATABASE_URL',
    kind: 'string',
    hint:
      'Postgres connection string for the dashboard control-plane DB ' +
      '(auth nonces, billing idempotency table). e.g. postgres://gibson_dashboard:...@cnpg-rw:5432/gibson_dashboard',
  },
  {
    name: 'NEO4J_URI',
    kind: 'string',
    hint:
      'Neo4j bolt endpoint for the knowledge graph (e.g. bolt://neo4j-service:7687).',
  },
  {
    name: 'NEO4J_PASSWORD',
    kind: 'string',
    hint:
      'Neo4j password mounted from the gibson-neo4j-auth secret. ' +
      'No default, fail-fast per one-code-path.',
  },
  {
    name: 'REDIS_URL',
    kind: 'string',
    hint:
      'Redis connection URL used for session invalidation + rate-limiter ' +
      '(e.g. redis://gibson-redis:6379).',
  },

  // ---- Feature switches ----
  {
    name: 'DASHBOARD_CAPTCHA_PROVIDER',
    kind: 'string',
    hint:
      'CAPTCHA provider id: "turnstile" | "hcaptcha" | "disabled". ' +
      'Explicit choice required, no implicit disable.',
  },
  {
    name: 'DASHBOARD_HIBP_ENABLED',
    kind: 'boolean',
    hint:
      'Whether to call the haveibeenpwned range API during signup. ' +
      '"true" or "false", no implicit on-by-default.',
  },
  {
    name: 'DASHBOARD_EMAIL_PROVIDER',
    kind: 'string',
    hint:
      'Email provider: "log" | "resend" | "smtp" | "ses". Explicit choice required.',
  },

  // ---- Observability ----
  // Mission/daemon logs are now read through the daemon LogsService
  // (gibson.daemon.logs.v1) over Envoy + ext-authz (dashboard#811); the
  // dashboard no longer dials Loki directly, so LOKI_URL / LOKI_TENANT_ID are
  // no longer consumed here.
];

/**
 * Genuinely optional env vars, typed `string | undefined`. Each entry is
 * annotated with a one-line reason why absence is safe.
 *
 * Adding an entry here is a deliberate decision: prefer the REQUIRED_ENV
 * block whenever possible.
 */
export const OPTIONAL_ENV = [
  // ---- Optional Zitadel divergence hatch ----
  // Inherits ZITADEL_ISSUER when unset; only required in topologies where the
  // browser-facing and pod-internal Zitadel URLs MUST differ.
  'ZITADEL_INTERNAL_ISSUER',

  // ---- Auth.js legacy aliases ----
  // NEXTAUTH_URL / NEXTAUTH_SECRET are read-only legacy aliases for AUTH_URL /
  // AUTH_SECRET. Auth.js v5 honours either name; the dashboard requires
  // AUTH_URL / AUTH_SECRET, so the NEXTAUTH_* variants are intentionally
  // never required.
  'NEXTAUTH_URL',
  'NEXTAUTH_SECRET',

  // ---- Marketing host (deploy#630 S11 www/app split) ----
  // Full origin of the marketing host (e.g. https://www.zeroroot.ai:30443),
  // wired by the chart from `global.domain` + `gibson.wwwHost`. When unset
  // (single-origin local dev) the host split in middleware is disabled, so
  // localhost:3000 serves both marketing and product unchanged.
  'WWW_URL',

  // ---- Optional observability ----
  // Langfuse trace viewer; consumers handle null host.
  'LANGFUSE_HOST',
  'LANGFUSE_ADMIN_PUBLIC_KEY',
  'LANGFUSE_ADMIN_SECRET_KEY',

  // ---- SPIFFE socket (workload identity) ----
  // Defaults to /run/spire/agent.sock; chart override only.
  'SPIFFE_ENDPOINT_SOCKET',

  // ---- Provider-specific email creds (gated by DASHBOARD_EMAIL_PROVIDER) ----
  // The provider's constructor throws if its specific creds are missing -
  // the validator enforces only that DASHBOARD_EMAIL_PROVIDER is set.
  'DASHBOARD_EMAIL_RESEND_API_KEY',
  'DASHBOARD_EMAIL_RESEND_FROM',
  'DASHBOARD_EMAIL_SMTP_HOST',
  'DASHBOARD_EMAIL_SMTP_PORT',
  'DASHBOARD_EMAIL_SMTP_USER',
  'DASHBOARD_EMAIL_SMTP_PASS',
  'DASHBOARD_EMAIL_SMTP_FROM',
  'SES_FROM_ADDRESS',
  'AWS_REGION',
  'DASHBOARD_EMAIL_FROM',
  'CONTACT_SALES_INBOX',
  'DASHBOARD_SUPPORT_EMAIL',

  // ---- CAPTCHA secret (gated by DASHBOARD_CAPTCHA_PROVIDER) ----
  'DASHBOARD_CAPTCHA_SECRET_KEY',

  // ---- Stripe billing (gated by DASHBOARD_BILLING_PAID_TIERS_ENABLED) ----
  // validateBillingConfig() at boot already throws if the toggle is on and
  // any of these are missing. Optional at the validator level so non-billing
  // pods boot without them.
  //
  // DASHBOARD_BILLING_PAID_TIERS_ENABLED is the billing MASTER SWITCH. It
  // gates both (a) the server-side Stripe wiring (validateBillingConfig,
  // signup card flow) AND (b) the purchase/manage billing UI surfaces via
  // src/lib/billing/billing-enabled.ts — the single source of truth read by
  // the pricing checkout CTA, the settings Billing portal/upgrade buttons,
  // the quota-banner upgrade CTA, and the /api/billing/{checkout,portal}
  // routes (dashboard#809 / ADR-0050). Off (absent) = on-prem default:
  // no Stripe UI, app runs on the config-driven Entitlements default.
  // Plan/tier + entitlement/quota DISPLAY is never gated.
  'DASHBOARD_BILLING_PAID_TIERS_ENABLED',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PORTAL_CONFIGURATION_ID',
  'STRIPE_PRICE_TEAM',
  'STRIPE_PRICE_ORG',
  'STRIPE_PRICE_ENTERPRISE',
  // Card-first-signup mode guard (dashboard#767): explicit billing mode
  // ("test"|"live") asserted against the key prefix at boot. Required when
  // paid tiers are enabled; validateBillingConfig()/stripe.ts owns semantics.
  'STRIPE_EXPECTED_MODE',

  // ---- Social-provider creds (each pair is gated by its own pair of creds) ----
  // The dashboard's social-provider wiring refuses to start if exactly one of
  // a pair is set, the validator does not need to police that.
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITLAB_CLIENT_ID',
  'GITLAB_CLIENT_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'MICROSOFT_CLIENT_ID',
  'MICROSOFT_CLIENT_SECRET',
  'MICROSOFT_TENANT_ID',

  // ---- Zitadel admin ----
  // NOTE: the broad ZITADEL_SIGNUP_BOT_PAT + ZITADEL_EXTERNAL_DOMAIN pair was
  // removed in E9 (dashboard#812). Owner provisioning now runs daemon-side via
  // the unauthenticated gibson.tenant.v1.SignupService.Signup RPC, so the
  // dashboard holds NO Zitadel admin credential for signup.
  'ZITADEL_DASHBOARD_CLIENT_ID',
  'ZITADEL_DASHBOARD_CLIENT_SECRET',
  'ZITADEL_TOKEN_URL',
  'ZITADEL_SA_PAT',

  // ---- Tier / Billing metadata ----
  // GIBSON_TIER picks a self-serve tier display config; only relevant when
  // the dashboard is rendering tier UI. Set explicitly via Helm values.
  'GIBSON_TIER',

  // ---- Misc dashboard knobs ----
  // CIDR allow-list for /api/metrics, when unset the route is open to all.
  'DASHBOARD_METRICS_ALLOWED_CIDRS',
  // Auto-create personal org on first social-sign-in. Defaults true in code.
  'DASHBOARD_AUTO_CREATE_ORG',
  // Email verification cutoff used by one-shot migration; safe absent.
  'DASHBOARD_EMAIL_VERIFICATION_CUTOFF',
  // Social preview flag for the login page (dev knob).
  'DASHBOARD_SOCIAL_PREVIEW',
  // Debug toggle.
  'DASHBOARD_DEBUG',
  // Logging level; defaults via isProduction in logger.ts.
  'LOG_LEVEL',
  // Test-fixtures bypass (NODE_ENV-gated independently).
  'TEST_FIXTURES_ENABLED',
  'TEST_FIXTURES_BYPASS_PRICING',
  'TEST_AUTH_BYPASS',

  // ---- SA identity map override ----
  // The chart writes the map to /shared/sa-identity-map.json by default;
  // SA_IDENTITY_MAP_PATH is an override hatch only.
  'SA_IDENTITY_MAP_PATH',

  // ---- Public Next.js variables ----
  // NEXT_PUBLIC_* are evaluated at build time and ship to the browser; not a
  // boot-time concern.
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_IDENTITY_PROVIDER_URL',
  // Card-first signup: publishable key for the in-page Payment Element.
  // Read at RUNTIME by the signup server component and passed to the client
  // (NOT NEXT_PUBLIC / build-time): the shared :main image can't bake a per-env
  // test-vs-live key, so it must be injected at runtime (dashboard#783).
  'STRIPE_PUBLISHABLE_KEY',

  // NOTE: the previous *_AUTHZ_PERMISSIVE_DEV escape hatches were deleted by
  // spec "eliminate-permissive-authz" Requirement 2. The check-no-permissive-
  // flags.mjs prebuild guard rejects any literal reference here, so they are
  // intentionally absent from this allowlist, never re-add them.

  // ---- Runtime-supplied (set by Node / Next.js itself) ----
  'NODE_ENV',
  'NEXT_RUNTIME',
  'KUBERNETES_SERVICE_HOST',
] as const;

export type RequiredEnvName = (typeof REQUIRED_ENV)[number]['name'];
export type OptionalEnvName = (typeof OPTIONAL_ENV)[number];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class EnvValidationError extends Error {
  readonly missing: readonly RequiredEnvSpec[];
  readonly malformed: readonly { spec: RequiredEnvSpec; value: string; reason: string }[];

  constructor(
    missing: readonly RequiredEnvSpec[],
    malformed: readonly { spec: RequiredEnvSpec; value: string; reason: string }[],
  ) {
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(
        `Missing ${missing.length} required env var(s):\n` +
          missing.map((s) => `  - ${s.name} (${s.kind}): ${s.hint}`).join('\n'),
      );
    }
    if (malformed.length > 0) {
      parts.push(
        `Malformed ${malformed.length} required env var(s):\n` +
          malformed
            .map(
              (m) =>
                `  - ${m.spec.name} (${m.spec.kind}): ${m.reason}, got ${JSON.stringify(m.value)}`,
            )
            .join('\n'),
      );
    }
    super(
      `[env-validator] Refusing to start, environment is misconfigured.\n${parts.join('\n')}`,
    );
    this.name = 'EnvValidationError';
    this.missing = missing;
    this.malformed = malformed;
  }
}

/**
 * Returns true when the env var should be enforced in the current NODE_ENV.
 * Spec rule: production-only entries are skipped outside production so
 * `pnpm dev` / `pnpm build` static analysis still works on a developer
 * workstation without a fully-wired identity stack.
 */
function isEnforcedInCurrentMode(spec: RequiredEnvSpec): boolean {
  if (!spec.prodOnly) return true;
  return process.env.NODE_ENV === 'production';
}

function validateShape(
  spec: RequiredEnvSpec,
  value: string,
): { ok: true } | { ok: false; reason: string } {
  switch (spec.kind) {
    case 'string':
      return value.length > 0 ? { ok: true } : { ok: false, reason: 'empty string' };
    case 'url':
      try {
        // URL constructor throws on malformed strings.
        // We accept any http(s)/bolt(s)/redis URL, the kind is a hint, not a scheme filter.
        new URL(value);
        return { ok: true };
      } catch {
        return { ok: false, reason: 'not a parseable URL' };
      }
    case 'boolean':
      return /^(true|false|1|0)$/i.test(value)
        ? { ok: true }
        : { ok: false, reason: 'expected "true" | "false" | "1" | "0"' };
    case 'number':
      return Number.isFinite(Number(value))
        ? { ok: true }
        : { ok: false, reason: 'expected a numeric string' };
  }
}

/**
 * Validate every required env var. Throws {@link EnvValidationError} listing
 * all missing/malformed keys at once (single-pass, no early-exit) so an
 * operator fixing the env never has to run-fix-run-fix in a loop.
 *
 * Idempotent and side-effect-free, safe to call multiple times.
 */
export function validateEnv(): void {
  const missing: RequiredEnvSpec[] = [];
  const malformed: { spec: RequiredEnvSpec; value: string; reason: string }[] = [];

  for (const spec of REQUIRED_ENV) {
    if (!isEnforcedInCurrentMode(spec)) continue;
    const raw = process.env[spec.name];
    if (raw === undefined) {
      missing.push(spec);
      continue;
    }
    const result = validateShape(spec, raw);
    if (!result.ok) {
      malformed.push({ spec, value: raw, reason: result.reason });
    }
  }

  if (missing.length > 0 || malformed.length > 0) {
    throw new EnvValidationError(missing, malformed);
  }
}

// ---------------------------------------------------------------------------
// Typed accessors, callers import `env` and use named properties.
// ---------------------------------------------------------------------------

/**
 * Typed env accessor.
 *
 * - For REQUIRED keys: returns `string` and asserts non-empty (validateEnv
 *   already ran at boot, but we re-check on every access so unit tests
 *   that monkey-patch `process.env` see consistent behaviour).
 * - For OPTIONAL keys: returns `string | undefined`.
 *
 * Do NOT add `process.env.X ?? "..."` patterns anywhere else in the
 * codebase, extend this object instead, decide whether the key belongs in
 * REQUIRED_ENV or OPTIONAL_ENV, and import `env.X` at the callsite.
 */
type EnvShape = {
  readonly [K in RequiredEnvName]: string;
} & {
  readonly [K in OptionalEnvName]: string | undefined;
};

// isBuildPhase returns true while `next build` is running. Mirrors the
// helper inside auth.ts (slice #196 pattern). Page-data collection inside
// `next build` import-evaluates every route module with no runtime env;
// returning a namespaced synthetic value lets the build complete instead
// of crashing at module-load when an API route reads env.X at call-time
// inside the page-data probe. Runtime / dev / test still throws so a
// misconfigured pod CrashLoopBackOffs at boot.
function isBuildPhase(): boolean {
  return (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.npm_lifecycle_event === 'build' ||
    process.env.npm_lifecycle_event === 'prebuild'
  );
}

function readRequired(name: RequiredEnvName): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    if (isBuildPhase()) {
      // Synthetic placeholder, clearly identifiable in logs / network
      // requests if it ever leaks past the build into a running request.
      return `__BUILD_TIME_STUB_${name}__`;
    }
    // validateEnv() should have caught this, but if a test reaches in via
    // delete-then-import we want a loud throw rather than silently returning
    // empty-string. Mirrors the inline requireEnv() pattern slice #196 used.
    throw new EnvValidationError(
      [REQUIRED_ENV.find((s) => s.name === name)!],
      [],
    );
  }
  return raw;
}

function readOptional(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw === '' ? undefined : raw;
}

/**
 * Implementation: a Proxy that dispatches each property access to the
 * appropriate reader. Avoids enumerating ~50 getter definitions by hand
 * (and the resulting tax on every future edit).
 */
const REQUIRED_NAMES = new Set<string>(REQUIRED_ENV.map((s) => s.name));
const OPTIONAL_NAMES = new Set<string>(OPTIONAL_ENV);

export const env: EnvShape = new Proxy({} as EnvShape, {
  get(_target, prop: string | symbol) {
    if (typeof prop !== 'string') return undefined;
    if (REQUIRED_NAMES.has(prop)) {
      return readRequired(prop as RequiredEnvName);
    }
    if (OPTIONAL_NAMES.has(prop)) {
      return readOptional(prop);
    }
    // Accessing a key not enumerated in either table is a bug, the whole
    // point of this module is that the env surface is closed-set.
    throw new Error(
      `[env-validator] env.${prop} is not declared. Add it to REQUIRED_ENV or OPTIONAL_ENV in src/lib/env-validator.ts.`,
    );
  },
}) as EnvShape;
