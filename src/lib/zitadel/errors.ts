/**
 * Structured error type for all Zitadel Management API responses.
 *
 * SECURITY: This class intentionally omits the PAT from all messages,
 * formatted strings, and stack traces. Never pass credentials to any
 * field of this class.
 */

/** Error codes that identify the type of Zitadel API failure. */
export type ZitadelErrorId = string;

/**
 * Thrown by `HttpZitadelAdminClient` whenever the Zitadel API returns a
 * non-2xx status or a connection-level failure occurs.
 */
export class ZitadelApiError extends Error {
  /** HTTP status code from the Zitadel response, or 0 for connection errors. */
  readonly httpStatus: number;

  /**
   * The Zitadel-specific error code returned in the response body
   * (e.g. `"AUTHZ-4Mfsf"`). Empty string if the error was connection-level.
   */
  readonly zitadelErrorId: ZitadelErrorId;

  /**
   * The Zitadel-provided human-readable description from the response body.
   * Safe to log; never contains credentials.
   */
  readonly zitadelErrorMessage: string;

  constructor(
    httpStatus: number,
    zitadelErrorId: ZitadelErrorId,
    zitadelErrorMessage: string,
  ) {
    // Build a message that is safe for logs — no PAT, no passwords.
    const safeMessage = `Zitadel API error: HTTP ${httpStatus} [${zitadelErrorId || 'no-code'}] ${zitadelErrorMessage || '(no message)'}`;
    super(safeMessage);
    this.name = 'ZitadelApiError';
    this.httpStatus = httpStatus;
    this.zitadelErrorId = zitadelErrorId;
    this.zitadelErrorMessage = zitadelErrorMessage;

    // Maintain correct prototype chain when compiled to ES5.
    Object.setPrototypeOf(this, ZitadelApiError.prototype);
  }

  /**
   * Returns true when it is safe to retry the request.
   *
   * Retryable:
   *  - 5xx server-side errors
   *  - Connection-level failures (httpStatus === 0): ECONNRESET, ETIMEDOUT
   *
   * Not retryable:
   *  - 4xx client errors (bad request, conflict, not found, …)
   */
  isRetryable(): boolean {
    if (this.httpStatus === 0) {
      // Connection-level failure; treat as transient.
      return true;
    }
    if (this.httpStatus >= 500) {
      return true;
    }
    // 4xx and any other status are permanent failures.
    return false;
  }
}
