/**
 * Typed error classes for K8s API failures, mapped from the raw errors
 * returned by @kubernetes/client-node.
 */

export class K8sError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class K8sNotFoundError extends K8sError {}
export class K8sConflictError extends K8sError {}
export class K8sForbiddenError extends K8sError {}
export class K8sValidationError extends K8sError {}
export class K8sUnavailableError extends K8sError {}

export function mapK8sError(err: unknown): Error {
  if (err instanceof K8sError) return err;
  // @kubernetes/client-node throws ApiException with .code + .body (the
  // body is the raw JSON string of the K8s Status object); older client
  // versions threw HttpError with .statusCode + a parsed .body object.
  // Duck-type both so a 404 never falls through to status 0, that
  // misclassified every "tenant not found" as K8sUnavailableError and
  // warn-spammed the slug-availability happy path (dashboard#751).
  const e = err as {
    statusCode?: number;
    code?: number;
    body?: { message?: string; reason?: string } | string;
  };
  const status = e?.statusCode ?? e?.code ?? 0;
  let bodyMessage: string | undefined;
  if (typeof e?.body === 'string') {
    try {
      bodyMessage = (JSON.parse(e.body) as { message?: string })?.message;
    } catch {
      // Non-JSON body, fall through to err.message.
    }
  } else {
    bodyMessage = e?.body?.message;
  }
  const message = bodyMessage ?? String((err as Error)?.message ?? err);
  switch (status) {
    case 404:
      return new K8sNotFoundError(message, err);
    case 409:
      return new K8sConflictError(message, err);
    case 401:
    case 403:
      return new K8sForbiddenError(message, err);
    case 400:
    case 422:
      return new K8sValidationError(message, err);
    default:
      if (status >= 500 || status === 0) {
        return new K8sUnavailableError(message, err);
      }
      return new K8sError(message, err);
  }
}
