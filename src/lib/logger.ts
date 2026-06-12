/**
 * Canonical structured logger for the Gibson Dashboard.
 *
 * This module is the single approved logging surface for the dashboard's
 * server-side code (API routes, server actions, instrumentation). Any
 * `console.*` call in committed code is a regression unless it is
 * explicitly gated to non-production browser builds.
 *
 * The logger is built on top of `pino` and ships:
 *   - JSON output in production (one log line per event, easy to ingest).
 *   - Pretty output in development (colorised, human-readable).
 *   - A redactor that scrubs PII (email, tenant/user/session ids, tokens,
 *     passwords) before serialisation. New PII fields MUST be added to the
 *     `redact.paths` list below.
 *
 * Usage:
 *
 *     import { logger } from '@/src/lib/logger';
 *
 *     logger.info({ tenantId, action: 'invite' }, 'invitation issued');
 *     logger.error({ err, route: 'analytics/kpis' }, 'analytics RPC failed');
 *
 * Notes:
 *   - Always pass structured fields as the first argument and a short
 *     human-readable message as the second; pino handles the merge.
 *   - Do NOT inline PII inside the message string, only in the structured
 *     fields where the redactor can see them.
 *   - For browser-side hooks, prefer the dev-mode `NODE_ENV` console gate
 *     and stripped error payloads; this server logger is not safe to
 *     bundle into the client.
 */

import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProduction ? 'info' : 'debug'),
  redact: {
    paths: [
      'tenantId',
      'memberId',
      'userId',
      'sessionId',
      'sessionToken',
      'zitadelSubject',
      'zitadelUserId',
      'session.user.email',
      'email',
      '*.email',
      'token',
      'password',
      'apiKey',
      'secret',
    ],
    remove: false,
    censor: '[redacted]',
  },
  transport: !isProduction
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      }
    : undefined,
});

export type Logger = typeof logger;
