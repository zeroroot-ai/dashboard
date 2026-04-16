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
  // @kubernetes/client-node throws HttpError with .statusCode + .body.
  // Use duck typing to avoid importing the class directly.
  const e = err as { statusCode?: number; body?: { message?: string; reason?: string } };
  const status = e?.statusCode ?? 0;
  const message = e?.body?.message ?? String((err as Error)?.message ?? err);
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
