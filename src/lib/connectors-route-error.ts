/**
 * Shared error translation for the app/api/settings/connectors/* route handlers.
 *
 * A ConnectError from the daemon gRPC layer maps to the HTTP status that matches
 * its gRPC status code; any other error is an internal server error. Only error
 * metadata (code, message) is logged, never a request body or a credential.
 */
import { ConnectError, Code } from '@connectrpc/connect';
import { logger } from '@/src/lib/logger';

function mapCodeToHttpStatus(code: Code): number {
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
    case Code.Unavailable:
      return 503;
    case Code.DeadlineExceeded:
      return 504;
    default:
      return 500;
  }
}

export interface ConnectorErrorBody {
  error: { code: string; message: string };
}

/** Translate any thrown error into an HTTP status and a safe JSON body. */
export function connectorErrorResponse(err: unknown, context: string): Response {
  if (err instanceof ConnectError) {
    const status = mapCodeToHttpStatus(err.code);
    logger.warn({ context, code: Code[err.code], reason: err.message }, 'connectors route error');
    const body: ConnectorErrorBody = {
      error: { code: Code[err.code].toLowerCase(), message: err.rawMessage },
    };
    return Response.json(body, { status });
  }
  logger.error(
    { context, reason: err instanceof Error ? err.message : String(err) },
    'connectors route unexpected error',
  );
  const body: ConnectorErrorBody = {
    error: { code: 'internal', message: 'An unexpected error occurred.' },
  };
  return Response.json(body, { status: 500 });
}
