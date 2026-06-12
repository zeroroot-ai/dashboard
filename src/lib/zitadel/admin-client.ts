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
// Machine user (service account) types, spec
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
  /** Display name shown in the Zitadel console, falls back to `username`. */
  name?: string;
  /**
   * Optional human-readable description. Stored on the Zitadel user
   * object so org admins can identify the agent in the console.
   */
  description?: string;
  /**
   * Org ID the machine user belongs to. When omitted, the user is created
   * in the PAT's default org, which, for the signup-bot PAT, is the IAM
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
  /** OAuth2 `client_secret`, emitted exactly once. NEVER logged. */
  clientSecret: string;
}

/**
 * Inputs to `createSession`, the V2 Session Service entry point used by the
 * signup auto-login flow (spec/issue dashboard#41).
 *
 * Both `loginName` and `password` are forwarded to Zitadel as the two
 * authentication "checks" in a single POST /v2/sessions call:
 *   - `checks.user.loginName: <email>`    , identifies the human user
 *   - `checks.password.password: <pw>`    , proves the user knows the password
 *
 * The signup form just collected the password from the user (they typed it
 * moments ago) AND we created the user with that exact password via the
 * admin API in the same Server Action, so combining both checks is the
 * canonical "you just signed up, here's a session" pattern Zitadel
 * documents for the build-your-own-login-UI flow.
 *
 * SECURITY: the password lives in the request body only. NEVER log this
 * struct or any field of it. The PAT calling this endpoint must hold the
 * `IAM_LOGIN_CLIENT` role (granted in gitops#90); without it Zitadel
 * returns 403 PERMISSION_DENIED.
 */
export interface CreateSessionInput {
  /** The Zitadel loginName, the dashboard uses email as loginName at user-creation time. */
  loginName: string;
  /** Plaintext password the user just typed in the signup form. NEVER logged. */
  password: string;
}

/**
 * Output of `createSession`. The `sessionToken` is opaque-but-secret, treat
 * like a bearer credential, never log it, never expose to the browser. It
 * is the ONE input to `finalizeAuthRequest` and is single-use in that flow.
 */
export interface ZitadelSession {
  /** Stable Zitadel session ID. Safe to log; pairs with the session resource. */
  sessionId: string;
  /**
   * Opaque token authenticating the holder as the session subject. The
   * server-side Action passes this directly into `finalizeAuthRequest`
   * within the same request lifecycle and discards it afterwards.
   * NEVER log this value.
   */
  sessionToken: string;
}

/**
 * Input to `finalizeAuthRequest`, completes a parked OIDC auth_request by
 * pinning it to a pre-established V2 session. The browser receives the
 * returned `callbackUrl` and lands on the relying party's `/api/auth/callback/*`
 * endpoint with the standard `code=...&state=...` query string.
 *
 * Spec: Zitadel V2 OIDC Service, `POST /v2/oidc/auth_requests/{authRequestId}`
 * (the gRPC method name is `CreateCallback`; the HTTP path is just the
 * resource with POST per Zitadel's `option (google.api.http)`).
 */
export interface FinalizeAuthRequestInput {
  /**
   * The Zitadel-assigned ID of the OIDC auth_request initiated server-side
   * by the relying party. Extracted from the `authRequest=` query param of
   * the redirect Location header that Zitadel emits on /oauth/v2/authorize.
   */
  authRequestId: string;
  /** Session returned by `createSession`. */
  session: ZitadelSession;
}

/**
 * Output of `finalizeAuthRequest`. The `callbackUrl` is the absolute URL
 * the user agent must follow to complete the OIDC handshake. It points at
 * the relying party's registered redirect_uri with `code=...&state=...`.
 */
export interface FinalizeAuthRequestResult {
  /** Absolute URL, typically `${ZITADEL_ISSUER}/oauth/v2/...` or directly the RP callback. */
  callbackUrl: string;
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
  /** POST /v2/users/human, creates a new human user. On 409 throws ZitadelApiError with httpStatus 409. */
  createHumanUser(input: CreateHumanUserInput): Promise<ZitadelUser>;

  /** POST /v2/users, search by email. Returns the first matching user or null. */
  findUserByEmail(email: string): Promise<ZitadelUser | null>;

  /**
   * POST /v2/users/:userId/email/resend, triggers a verification email.
   * 404 is fatal. 5xx is retried.
   */
  sendVerificationEmail(userId: string): Promise<void>;

  /**
   * POST /v2/users/:userId/password, set a new password without requiring
   * the current one. Used by signup-resume to update the password when the
   * user retries a failed signup attempt (the original password from the
   * first attempt would otherwise stick, even though the form accepted a
   * new value). Idempotent, setting the same password twice is a no-op.
   * `changeRequired: false` so the user is not forced to change on first
   * sign-in.
   */
  setUserPassword(userId: string, password: string): Promise<void>;

  /** GET /auth/v1/policies/passwords/complexity, fetches the effective password policy for the caller's org. */
  getPasswordComplexityPolicy(): Promise<PasswordPolicy>;

  /**
   * POST /management/v1/users/machine, creates a new machine user (service
   * account) used for the OAuth2 client_credentials grant. The returned
   * userId is the Zitadel subject; the secret is minted separately by
   * {@link addMachineSecret}. Spec: unified-identity-and-authorization R1.4.
   */
  createMachineUser(input: CreateMachineUserInput): Promise<ZitadelMachineUser>;

  /**
   * PUT /management/v1/users/{userId}/secret, generates a fresh
   * client_secret for the machine user. The plaintext secret is returned
   * exactly once and CANNOT be retrieved again; it must be surfaced to
   * the registering admin in the same response. Spec: R9.8.
   */
  addMachineSecret(userId: string, orgId?: string): Promise<MachineSecret>;

  /**
   * POST /management/v1/projects/{projectId}/members, adds a user
   * (machine or human) to a Zitadel project with one or more project-level
   * role keys. The role grant is what makes the project's
   * `urn:zitadel:iam:org:project:roles` claim show up in the issued JWT.
   * Spec: R1.4 / R9.8 (project membership for agents).
   */
  addProjectMember(input: AddProjectMemberInput): Promise<void>;

  /**
   * POST /v2/sessions, creates a Zitadel session for the supplied user,
   * authenticated by password. Used by the signup auto-login pipeline
   * (issue dashboard#41) to mint a session immediately after admin-API
   * user provisioning so the caller can complete a parked OIDC auth_request
   * without bouncing the user to Zitadel's hosted login UI.
   *
   * Requires the calling PAT to hold `IAM_LOGIN_CLIENT` (gitops#90). On
   * 403 PERMISSION_DENIED the auto-login flow falls back to the standard
   * /login redirect (graceful failure UX); the ZitadelApiError is rethrown
   * for the action layer to catch.
   *
   * SECURITY: the password is forwarded to Zitadel in the request body
   * only. Never log it, never persist it.
   */
  createSession(input: CreateSessionInput): Promise<ZitadelSession>;

  /**
   * POST /v2/oidc/auth_requests/{authRequestId}, finalises a parked OIDC
   * auth_request by binding it to an established session (gRPC method
   * `CreateCallback`; HTTP path is the resource with POST).
   * Returns the absolute URL the user agent must follow to complete the
   * code/state hand-off with the relying party.
   *
   * Spec: Zitadel V2 OIDC Service. Requires `IAM_LOGIN_CLIENT` (gitops#90).
   * On any failure the caller should fall back to the standard hosted
   * login flow, the user has a valid Zitadel account either way.
   */
  finalizeAuthRequest(
    input: FinalizeAuthRequestInput,
  ): Promise<FinalizeAuthRequestResult>;

  /**
   * GET /management/v1/users/{userId}/metadata/{key}, fetches a single
   * metadata value for a user. Zitadel returns the value base64-encoded;
   * this method decodes it before returning. Returns null on 404 so
   * callers can treat "never set" as a normal state, and on connection
   * errors so the user-pref flow degrades gracefully rather than blocking
   * sign-in.
   *
   * Generic per-user metadata reader for Zitadel-canonical preferences.
   */
  getUserMetadata(userId: string, key: string): Promise<string | null>;

  /**
   * POST /management/v1/users/{userId}/metadata/{key}, sets a metadata
   * value for a user. The value is base64-encoded for transport per
   * Zitadel's API contract.
   *
   * Generic per-user metadata writer for Zitadel-canonical preferences.
   */
  setUserMetadata(userId: string, key: string, value: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// URL sanitisation helpers
// ---------------------------------------------------------------------------

/**
 * Re-encodes bare '+' in a URL's query string as '%2B'.
 * Zitadel v4 may emit standard-base64 auth codes (which contain '+') in
 * callback URLs without percent-encoding them.  URLSearchParams.get() then
 * decodes '+' as space, corrupting the code before it reaches the token
 * endpoint.  See the full root-cause writeup in route.ts.
 */
function reencodeQueryPlus(url: string): string {
  if (!url.includes('+')) return url;
  const qi = url.indexOf('?');
  if (qi === -1) return url;
  return url.slice(0, qi) + '?' + url.slice(qi + 1).replace(/\+/g, '%2B');
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
   * e.g. auth.zeroroot.ai. Must be forwarded as the Host header so that
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
        // Unknown fetch error, wrap but do not retry.
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

      // 4xx, permanent, throw immediately.
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
    //, does NOT require the current password. The signup-bot PAT already
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
    // caller's org, default when no org override is set, which is exactly
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
  // Machine user (service account), spec
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
    // need JWTs so Envoy's jwt_authn provider can verify them, that is
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
      // NOT echo the username, the caller already has it.
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
      // Do NOT include any field of `response` in the error message -
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
      //, reject locally so the surfaced error is sharper than the API's.
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

  // -----------------------------------------------------------------------
  // V2 Session + OIDC callback methods (issue dashboard#41, signup
  // auto-login). Both require the calling PAT to hold IAM_LOGIN_CLIENT.
  //
  // Why these live on the admin client and not a separate "login client":
  // the build-your-own-login-UI flow is, by Zitadel's design, an admin-API
  // operation, the relying party uses a privileged service account to
  // mint a session on behalf of a user that just identified itself by
  // password. The role distinction (IAM_LOGIN_CLIENT vs IAM_USER_MANAGER)
  // is a Zitadel role grant; the dashboard's signup-bot service account
  // is the single home for all such grants.
  //
  // SECURITY:
  //   - The `password` argument to createSession is forwarded into the
  //     request body and NEVER logged. Same treatment as createHumanUser.
  //   - The returned `sessionToken` is bearer-credential-equivalent. The
  //     action layer is the single caller and consumes it inline in the
  //     same Server Action invocation, it is never returned to the
  //     browser, never persisted, never logged.
  // -----------------------------------------------------------------------

  async createSession(input: CreateSessionInput): Promise<ZitadelSession> {
    // V2 Session API request body schema:
    //   {
    //     checks: {
    //       user:     { loginName: "..." },
    //       password: { password:  "..." }
    //     }
    //   }
    // Both checks are combined in a single create call, Zitadel executes
    // them atomically and either returns a verified session or rejects.
    // SECURITY: input.password is in the body only, never in headers/URL.
    const body = {
      checks: {
        user: { loginName: input.loginName },
        password: { password: input.password },
      },
    };

    const response = await this.request<{
      sessionId?: string;
      sessionToken?: string;
      details?: unknown;
    }>('POST', '/v2/sessions', body);

    if (!response.sessionId || !response.sessionToken) {
      // Do NOT echo `response` in the error message, the sessionToken
      // would leak on the malformed-response path. The error type matches
      // the rest of the client so callers can use the same isRetryable()
      // / httpStatus discrimination.
      throw new ZitadelApiError(
        0,
        'NO_SESSION',
        'Zitadel response missing sessionId or sessionToken',
      );
    }

    return {
      sessionId: response.sessionId,
      sessionToken: response.sessionToken,
    };
  }

  async finalizeAuthRequest(
    input: FinalizeAuthRequestInput,
  ): Promise<FinalizeAuthRequestResult> {
    // Zitadel V2 OIDC's CreateCallback RPC is transcoded to
    // `POST /v2/oidc/auth_requests/{auth_request_id}` (same resource path
    // as the GET, just the POST verb). The gRPC method name `CreateCallback`
    // is NOT part of the HTTP path, see
    // proto/zitadel/oidc/v2/oidc_service.proto:
    //
    //   rpc CreateCallback (CreateCallbackRequest) returns (CreateCallbackResponse) {
    //     option (google.api.http) = {
    //       post: "/v2/oidc/auth_requests/{auth_request_id}"
    //       body: "*"
    //     };
    //   }
    //
    // A `/CreateCallback` suffix produces a router 404
    // (`{"code":5,"message":"Not Found"}`) and the auto-login dance silently
    // falls back to /login.
    const body = {
      session: {
        sessionId: input.session.sessionId,
        sessionToken: input.session.sessionToken,
      },
    };

    const response = await this.request<{
      callbackUrl?: string;
      details?: unknown;
    }>(
      'POST',
      `/v2/oidc/auth_requests/${encodeURIComponent(input.authRequestId)}`,
      body,
    );

    if (!response.callbackUrl) {
      throw new ZitadelApiError(
        0,
        'NO_CALLBACK_URL',
        'Zitadel response missing callbackUrl',
      );
    }

    // Zitadel v4 may include standard-base64 auth codes (containing '+') in
    // the callbackUrl without percent-encoding them.  Re-encode '+' as '%2B'
    // so that URLSearchParams.get('code') in the Auth.js callback handler
    // returns the correct base64 character rather than a space.
    // Primary fix is in app/api/auth/[...nextauth]/route.ts; this is
    // defence-in-depth for the auto-login path.
    return { callbackUrl: reencodeQueryPlus(response.callbackUrl) };
  }

  /**
   * GET /management/v1/users/{userId}/metadata/{key}. Returns the decoded
   * value or null on 404 / connection failure. Never throws, this is a
   * preference read; if it fails the caller falls back to defaults.
   */
  async getUserMetadata(userId: string, key: string): Promise<string | null> {
    try {
      const resp = await this.request<{ metadata?: { value?: string } }>(
        'GET',
        `/management/v1/users/${encodeURIComponent(userId)}/metadata/${encodeURIComponent(key)}`,
      );
      const encoded = resp?.metadata?.value;
      if (!encoded) return null;
      return Buffer.from(encoded, 'base64').toString('utf8');
    } catch (err) {
      if (err instanceof ZitadelApiError && err.httpStatus === 404) {
        return null;
      }
      // Connection or other transient, degrade to "never set".
      return null;
    }
  }

  /**
   * POST /management/v1/users/{userId}/metadata/{key} with base64-encoded
   * value. Throws ZitadelApiError on permanent failures so the caller can
   * decide whether to surface the failure to the user (writes are
   * expected to succeed; a 5xx storm during a theme toggle is worth
   * logging at minimum).
   */
  async setUserMetadata(
    userId: string,
    key: string,
    value: string,
  ): Promise<void> {
    const encoded = Buffer.from(value, 'utf8').toString('base64');
    await this.request<void>(
      'POST',
      `/management/v1/users/${encodeURIComponent(userId)}/metadata/${encodeURIComponent(key)}`,
      { value: encoded },
    );
  }
}
