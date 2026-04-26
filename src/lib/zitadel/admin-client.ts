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

  /** GET /auth/v1/policies/passwords/complexity — fetches the effective password policy for the caller's org. */
  getPasswordComplexityPolicy(): Promise<PasswordPolicy>;
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
   */
  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.pat}`,
      Host: this.externalDomain,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Executes a fetch with automatic retry on 5xx and connection errors.
   * Throws `ZitadelApiError` on permanent failures.
   *
   * @param method  HTTP verb
   * @param path    Path relative to apiUrl, e.g. "/v2/users/human"
   * @param body    Optional JSON-serialisable body. Passwords must not be logged.
   */
  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers = this.buildHeaders();
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
}
