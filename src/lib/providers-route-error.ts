/**
 * Shared error-translation helpers for the app/api/settings/providers/* route handlers.
 *
 * ConnectErrors from the daemon gRPC layer are translated to HTTP status codes
 * that match the semantic of the originating gRPC status code. All other errors
 * are treated as internal server errors.
 *
 * IMPORTANT: Never log request bodies or credential fields, only log error
 * metadata (code, message) so plaintext credentials cannot appear in logs.
 */

import { ConnectError, Code } from '@connectrpc/connect';
import { logger } from '@/src/lib/logger';

/**
 * Map a Connect gRPC status code to an HTTP status code.
 */
export function mapCodeToHttpStatus(code: Code): number {
  switch (code) {
    case Code.Unauthenticated:
      return 401;
    case Code.PermissionDenied:
      return 403;
    case Code.NotFound:
      return 404;
    case Code.AlreadyExists:
      return 409;
    case Code.InvalidArgument:
      return 400;
    case Code.FailedPrecondition:
      return 412;
    case Code.ResourceExhausted:
      return 429;
    case Code.Unimplemented:
      return 501;
    case Code.Unavailable:
      return 503;
    case Code.DeadlineExceeded:
      return 504;
    default:
      return 500;
  }
}

/**
 * Translate an unknown thrown value into a JSON Response with the appropriate
 * HTTP status. ConnectErrors from the daemon are mapped by code; anything else
 * becomes a 500.
 *
 * Only the error code and daemon-provided message are included in the response
 * body, never credential material or request body content.
 */
export function translateError(err: unknown): Response {
  if (err instanceof ConnectError) {
    const status = mapCodeToHttpStatus(err.code);
    // 5xx codes mean the daemon hit an internal failure (e.g. secrets circuit
    // open, KEK unavailable). Log so the pod log shows something, without
    // this the caller sees a 500 with zero diagnostic output in the dashboard.
    if (status >= 500) {
      logger.error(
        { code: err.code, httpStatus: status, daemonMessage: err.rawMessage, route: 'providers' },
        'daemon RPC returned 5xx',
      );
    }
    return Response.json(
      { error: { code: err.code, message: err.rawMessage } },
      { status },
    );
  }

  // Include the error name and one line of stack for triage. NEVER include
  // request body content or credentials.
  if (err instanceof Error) {
    const stack = (err.stack ?? '').split('\n').slice(0, 3).join(' | ');
    logger.error(
      { errorName: err.name, errorMessage: err.message, stack, route: 'providers' },
      'unexpected error in providers route',
    );
  } else {
    logger.error({ thrown: String(err), route: 'providers' }, 'unexpected non-Error throw in providers route');
  }
  return Response.json(
    { error: { code: 'internal', message: 'Internal server error' } },
    { status: 500 },
  );
}
