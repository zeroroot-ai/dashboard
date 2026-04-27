/**
 * Zitadel Management API v1 + User Service v2 adapter.
 *
 * SECURITY rules enforced here:
 *  - The PAT is read only from the constructor argument and is included
 *    solely as an Authorization header value. It NEVER appears in log
 *    output, error messages, or stack traces.
 *  - Passwords passed to `createHumanUser` are forwarded to the Zitadel
 *    API request body only; they are never logged, cached, or included in
 *    any error object.
 *  - No module-level `fetch` calls. All network I/O is inside instance
 *    methods, invoked only after construction.
 */

import 'server-only';

import { ZitadelApiError } from './errors';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CreateHumanUserInput {
  email: string;
  givenName: string;
  familyName: string;
  /** Server-side only. Never logged. */
  password: string;
  /** false triggers the verification-email flow in Zitadel. */
  emailVerified: boolean;
}

export interface ZitadelUser {
  userId: string;
  state: 'active' | 'inactive' | 'initial';
  email: string;
}

export interface PasswordPolicy {
  minLength: number;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
}

// ---------------------------------------------------------------------------
// Machine user (service account) types — spec
// unified-identity-and-authorization Phase 4 (R1.4, R9.7, R9.8). Used by
// the dashboard's "Register Agent" flow to provision Zitadel service
// accounts for agents that authenticate via the OAuth2 client_credentials
// grant.
// ---------------------------------------------------------------------------

export interface CreateMachineUserInput {
  /**
   * Stable, URL-safe-ish login name in the org's namespace, e.g.
   * `agent-acme-redteam-1`. Zitadel rejects whitespace and most punctuation.
   * The caller is responsible for collision handling (HTTP 409 surfaces as
   * `ZitadelApiError` with `httpStatus: 409`).
   */
  username: string;
  /** Display name shown in the Zitadel console — falls back to `username`. */
  name?: string;
  /**
   * Optional human-readable description. Stored on the Zitadel user
   * object so org admins can identify the agent in the console.
   */
  description?: string;
  /**
   * Org ID the machine user belongs to. When omitted, the user is created
   * in the PAT's default org — which, for the signup-bot PAT, is the IAM
   * instance org. For per-tenant agents, the caller MUST supply the
   * tenant's Zitadel org ID.
   */
  orgId?: string;
}

export interface ZitadelMachineUser {
  userId: string;
  username: string;
}

export interface MachineSecret {
  /** OAuth2 `client_id` for the client_credentials grant. */
  clientId: string;
  /** OAuth2 `client_secret` — emitted exactly once. NEVER logged. */
  clientSecret: string;
}

export interface AddProjectMemberInput {
  /** Zitadel project ID the member is being granted on. */
  projectId: string;
  /** The Zitadel user ID (machine or human) to add. */
  userId: string;
  /**
   * Project role keys to grant. Match the keys defined on the Zitadel
   * project (e.g. `["agent"]`). The set must be non-empty.
   */
  roles: string[];
  /**
   * Org context for the membership write. Defaults to the PAT's home org.
   * When the project lives in a tenant org, the caller MUST pass that org
   * ID so the `x-zitadel-orgid` header reaches the right virtual host.
   */
  orgId?: string;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ZitadelAdminClient {
  /** POST /v2/users/human — creates a new human user. On 409 throws ZitadelApiError with httpStatus 409. */
  createHumanUser(input: CreateHumanUserInput): Promise<ZitadelUser>;

  /** POST /v2/users — search by email. Returns the first matching user or null. */
  findUserByEmail(email: string): Promise<ZitadelUser | null>;

  /**
   * POST /v2/users/:userId/email/resend — triggers a verification email.
   * 404 is fatal. 5xx is retried.
   */
  sendVerificationEmail(userId: string): Promise<void>;

  /**
   * POST /v2/users/:userId/password — set a new password without requiring
   * the current one. Used by signup-resume to update the password when the
   * user retries a failed signup attempt (the original password from the
   * first attempt would otherwise stick, even though the form accepted a
   * new value). Idempotent — setting the same password twice is a no-op.
   * `changeRequired: false` so the user is not forced to change on first
   * sign-in.
   */
  setUserPassword(userId: string, password: string): Promise<void>;

  /** GET /auth/v1/policies/passwords/complexity — fetches the effective password policy for the caller's org. */
  getPasswordComplexityPolicy(): Promise<PasswordPolicy>;

  /**
   * POST /management/v1/users/machine — creates a new machine user (service
   * account) used for the OAuth2 client_credentials grant. The returned
   * userId is the Zitadel subject; the secret is minted separately by
   * {@link addMachineSecret}. Spec: unified-identity-and-authorization R1.4.
   */
  createMachineUser(input: CreateMachineUserInput): Promise<ZitadelMachineUser>;

  /**
   * PUT /management/v1/users/{userId}/secret — generates a fresh
   * client_secret for the machine user. The plaintext secret is returned
   * exactly once and CANNOT be retrieved again; it must be surfaced to
   * the registering admin in the same response. Spec: R9.8.
   */
  addMachineSecret(userId: string, orgId?: string): Promise<MachineSecret>;

  /**
   * POST /management/v1/projects/{projectId}/members — adds a user
   * (machine or human) to a Zitadel project with one or more project-level
   * role keys. The role grant is what makes the project's
   * `urn:zitadel:iam:org:project:roles` claim show up in the issued JWT.
   * Spec: R1.4 / R9.8 (project membership for agents).
   */
  addProjectMember(input: AddProjectMemberInput): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constructor config
// ---------------------------------------------------------------------------

export interface ZitadelAdminClientConfig {
  /** Base URL of the internal Zitadel endpoint, e.g. http://zitadel.gibson.svc:8080 */
  apiUrl: string;
  /** Service account PAT. NEVER log this value. */
  pat: string;
  /**
   * The external domain that Zitadel uses for Host-header-based routing,
   * e.g. auth.zero-day.ai. Must be forwarded as the Host header so that
   * internal traffic reaches the right virtual host.
   */
  externalDomain: string;
}

// ---------------------------------------------------------------------------
// Retry helpers
// ---------------------------------------------------------------------------

const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const RETRY_CAP_MS = 5_000;

/** Exponential back-off with a cap. */
function backoffMs(attempt: number): number {
  const raw = RETRY_BASE_MS * Math.pow(2, attempt);
  return Math.min(raw, RETRY_CAP_MS);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** True for node-level connection errors that should trigger a retry. */
function isConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ECONNRESET' || code === 'ETIMEDOUT';
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class HttpZitadelAdminClient implements ZitadelAdminClient {
  private readonly apiUrl: string;
  private readonly pat: string;
  private readonly externalDomain: string;

  constructor(config: ZitadelAdminClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    // PAT is stored privately; it is used only to build the Authorization header.
    this.pat = config.pat;
    this.externalDomain = config.externalDomain;
  }

  // ---- private helpers ----

  /**
   * Builds the common request headers required by every Zitadel API call.
   * The PAT appears only in the Authorization value and is never stringified
   * into a log-safe form.
   *
   * `orgId`, when provided, is forwarded as `x-zitadel-orgid` so management
   * API writes hit the right tenant org (vs the PAT's home org).
   */
  private buildHeaders(orgId?: string): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.pat}`,
      Host: this.externalDomain,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (orgId) {
      headers['x-zitadel-orgid'] = orgId;
    }
    return headers;
  }

  /**
   * Executes a fetch with automatic retry on 5xx and connection errors.
   * Throws `ZitadelApiError` on permanent failures.
   *
   * @param method  HTTP verb
   * @param path    Path relative to apiUrl, e.g. "/v2/users/human"
   * @param body    Optional JSON-serialisable body. Passwords must not be logged.
   * @param orgId   Optional Zitadel org ID for `x-zitadel-orgid` routing.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    orgId?: string,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers = this.buildHeaders(orgId);
    const init: RequestInit = {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };

    let lastError: ZitadelApiError | null = null;

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await delay(backoffMs(attempt - 1));
      }

      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (err) {
        if (isConnectionError(err)) {
          // Construct a connection-level ZitadelApiError (httpStatus 0)
          // without embedding the original system error message verbatim,
          // in case it contains credentials from environment strings.
          const code = (err as NodeJS.ErrnoException).code ?? 'ECONNECT';
          lastError = new ZitadelApiError(0, code, 'Connection-level failure');
          continue;
        }
        // Unknown fetch error — wrap but do not retry.
        throw new ZitadelApiError(0, 'FETCH_ERROR', 'Unexpected fetch failure');
      }

      if (response.ok) {
        // 204 No Content has no JSON body.
        if (response.status === 204) {
          return undefined as unknown as T;
        }
        return (await response.json()) as T;
      }

      // Non-2xx: parse Zitadel error envelope.
      let zitadelErrorId = '';
      let zitadelErrorMessage = '';
      try {
        const errBody = (await response.json()) as {
          code?: number;
          message?: string;
          details?: Array<{ errorCode?: string }>;
        };
        zitadelErrorMessage = errBody.message ?? '';
        // Zitadel sometimes embeds the error code in details[0].errorCode
        zitadelErrorId = errBody.details?.[0]?.errorCode ?? String(errBody.code ?? '');
      } catch {
        // Ignore parse failures; the HTTP status is enough.
      }

      const apiError = new ZitadelApiError(
        response.status,
        zitadelErrorId,
        zitadelErrorMessage,
      );

      if (apiError.isRetryable()) {
        lastError = apiError;
        continue;
      }

      // 4xx — permanent, throw immediately.
      throw apiError;
    }

    // Exhausted retries.
    throw lastError ?? new ZitadelApiError(0, 'RETRY_EXHAUSTED', 'All retry attempts failed');
  }

  // ---- interface methods ----

  async createHumanUser(input: CreateHumanUserInput): Promise<ZitadelUser> {
    // SECURITY: input.password goes into the body only; never log input.
    const body = {
      username: input.email,
      profile: {
        givenName: input.givenName,
        familyName: input.familyName,
      },
      email: {
        email: input.email,
        isVerified: input.emailVerified,
      },
      password: {
        password: input.password,
        changeRequired: false,
      },
    };

    const response = await this.request<{
      userId: string;
      details?: { id?: string };
    }>('POST', '/v2/users/human', body);

    return {
      userId: response.userId,
      state: 'initial',
      email: input.email,
    };
  }

  async findUserByEmail(email: string): Promise<ZitadelUser | null> {
    const body = {
      queries: [
        {
          emailQuery: {
            emailAddress: email,
            method: 'TEXT_QUERY_METHOD_EQUALS',
          },
        },
      ],
    };

    const response = await this.request<{
      result?: Array<{
        userId: string;
        state: string;
        human?: { profile?: unknown; email?: { email?: string } };
      }>;
    }>('POST', '/v2/users', body);

    const first = response.result?.[0];
    if (!first) return null;

    const rawState = first.state?.toLowerCase() ?? '';
    const state: ZitadelUser['state'] =
      rawState === 'active' ? 'active' : rawState === 'inactive' ? 'inactive' : 'initial';

    return {
      userId: first.userId,
      state,
      email: first.human?.email?.email ?? email,
    };
  }

  async sendVerificationEmail(userId: string): Promise<void> {
    // Empty body is required by the Zitadel API.
    await this.request<void>('POST', `/v2/users/${userId}/email/resend`, {});
  }

  async setUserPassword(userId: string, password: string): Promise<void> {
    // POST /v2/users/:userId/password sets the password as IAM_USER_MANAGER
    // — does NOT require the current password. The signup-bot PAT already
    // holds IAM_USER_MANAGER for createHumanUser; the same scope covers
    // this endpoint. SECURITY: password lives in the request body only;
    // never log it.
    await this.request<void>('POST', `/v2/users/${userId}/password`, {
      newPassword: { password, changeRequired: false },
    });
  }

  async getPasswordComplexityPolicy(): Promise<PasswordPolicy> {
    // Use the Auth API endpoint. The instance-level admin endpoint
    // (/auth/v1/policies/passwords/complexity) requires IAM_OWNER, which the
    // signup-bot DOES NOT have by deliberate minimum-scope choice (see
    // post-install-job.yaml:381-384). The management endpoint
    // (/management/v1/policies/password/complexity) also requires elevated
    // permissions not granted to IAM_USER_MANAGER (verified via live probe
    // 2026-04-23). The auth endpoint returns the EFFECTIVE policy for the
    // caller's org — default when no org override is set — which is exactly
    // what the signup form validation needs. Spec: signup-zitadel-permissions-fix.
    const response = await this.request<{
      policy?: {
        minLength?: string | number;
        hasUppercase?: boolean;
        hasLowercase?: boolean;
        hasNumber?: boolean;
        hasSymbol?: boolean;
      };
    }>('GET', '/auth/v1/policies/passwords/complexity');

    const p = response.policy ?? {};
    return {
      minLength: typeof p.minLength === 'string' ? parseInt(p.minLength, 10) : (p.minLength ?? 12),
      hasUppercase: p.hasUppercase ?? false,
      hasLowercase: p.hasLowercase ?? false,
      hasNumber: p.hasNumber ?? false,
      hasSymbol: p.hasSymbol ?? false,
    };
  }

  // -----------------------------------------------------------------------
  // Machine user (service account) — spec
  // unified-identity-and-authorization Phase 4 (R1.4, R9.7, R9.8).
  //
  // SECURITY:
  //   - The machine secret returned by addMachineSecret() exists in
  //     plaintext exactly once, in the response body of POST /secret. We
  //     never persist it, never include it in error messages, never log
  //     any field of MachineSecret. The route handler is the single
  //     downstream consumer and is responsible for handing it to the
  //     browser exactly once and dropping it.
  //   - `username` and `description` are tenant-scoped identifiers; they
  //     may appear in logs.
  // -----------------------------------------------------------------------

  async createMachineUser(input: CreateMachineUserInput): Promise<ZitadelMachineUser> {
    // Zitadel's machine-user accessTokenType controls whether the
    // resulting access tokens are opaque or JWT. For the OIDC chain we
    // need JWTs so Envoy's jwt_authn provider can verify them — that is
    // the OIDC_TOKEN_TYPE_JWT enum, which the management API serialises
    // as the string `"OIDC_TOKEN_TYPE_JWT"` (vs the default
    // `"OIDC_TOKEN_TYPE_BEARER"` that yields opaque tokens).
    const body = {
      userName: input.username,
      name: input.name ?? input.username,
      description: input.description ?? '',
      accessTokenType: 'OIDC_TOKEN_TYPE_JWT',
    };
    const response = await this.request<{ userId?: string }>(
      'POST',
      '/management/v1/users/machine',
      body,
      input.orgId,
    );
    if (!response.userId) {
      // Surface as a connection-shaped ZitadelApiError so callers can
      // unify on isRetryable() / httpStatus checks. We deliberately do
      // NOT echo the username — the caller already has it.
      throw new ZitadelApiError(0, 'NO_USER_ID', 'Zitadel response missing userId');
    }
    return { userId: response.userId, username: input.username };
  }

  async addMachineSecret(userId: string, orgId?: string): Promise<MachineSecret> {
    // Zitadel mints both halves of the credential here. The plaintext
    // `clientSecret` is returned exactly once; subsequent reads of this
    // user yield only the bcrypt hash. Caller MUST surface to the admin
    // immediately and never persist.
    const response = await this.request<{
      clientId?: string;
      clientSecret?: string;
    }>('PUT', `/management/v1/users/${userId}/secret`, {}, orgId);

    if (!response.clientId || !response.clientSecret) {
      // Do NOT include any field of `response` in the error message —
      // it would leak the secret on the malformed-response path.
      throw new ZitadelApiError(
        0,
        'NO_MACHINE_SECRET',
        'Zitadel response missing clientId or clientSecret',
      );
    }
    return { clientId: response.clientId, clientSecret: response.clientSecret };
  }

  async addProjectMember(input: AddProjectMemberInput): Promise<void> {
    if (input.roles.length === 0) {
      // Zitadel requires at least one role on a project membership write
      // — reject locally so the surfaced error is sharper than the API's.
      throw new ZitadelApiError(0, 'NO_ROLES', 'addProjectMember requires at least one role');
    }
    const body = {
      userId: input.userId,
      roles: input.roles,
    };
    await this.request<unknown>(
      'POST',
      `/management/v1/projects/${input.projectId}/members`,
      body,
      input.orgId,
    );
  }
}
