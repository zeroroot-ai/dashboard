import 'server-only';

/**
 * Typed dashboard client methods for the daemon-mediated log read path,
 * gibson.daemon.logs.v1.LogsService (dashboard#811, E9 security hardening).
 *
 * The dashboard no longer talks to Loki directly. Previously
 * `src/lib/loki-client.ts` built the `X-Scope-OrgID` header and the
 * `tenant_id` LogQL filter from a client-held tenant value, a
 * tenant-isolation hazard. Now the daemon owns scoping: it derives the
 * caller's tenant from the authenticated identity server-side and
 * constructs the Loki query itself. These wrappers call
 * `userClient(LogsService)` so the call flows
 * dashboard → Envoy (JWT + SPIFFE mTLS) → daemon, never direct, exactly
 * like every other daemon RPC.
 *
 * `LogEntry` (unix_nanos / line / labels) is mapped to a
 * {@link DashboardLogEntry} whose `timestamp` is a JS `Date`, preserving the
 * shape the mission logs/events routes already consume (the old
 * `LokiLogEntry` carried the same fields).
 */

import { create } from '@bufbuild/protobuf';
import { userClient } from '../gibson-client';
import {
  LogsService,
  LogLevel,
  QueryMissionLogsRequestSchema,
  QueryDaemonLogsRequestSchema,
  type LogEntry,
} from '@/src/gen/gibson/daemon/logs/v1/logs_pb';

/**
 * A single log line, mapped from the daemon `LogEntry` proto. Mirrors the
 * shape the routes consumed from the old Loki client (timestamp + raw line +
 * stream labels) so the downstream JSON-parse logic is unchanged.
 */
export interface DashboardLogEntry {
  /** Emit time, reconstructed from the proto's unix_nanos field. */
  timestamp: Date;
  /** Raw log line (typically structured slog JSON). */
  line: string;
  /** Loki stream labels for this entry. */
  labels: Record<string, string>;
}

export type DashboardLogLevel = 'error' | 'warn' | 'info' | 'debug';

const NS_PER_MS = BigInt(1_000_000);

/** Date → Unix-nanos bigint for the request time-range fields. */
function dateToUnixNanos(date: Date): bigint {
  return BigInt(date.getTime()) * NS_PER_MS;
}

/** Proto LogEntry → dashboard shape (unix_nanos bigint → Date). */
function fromProtoEntry(entry: LogEntry): DashboardLogEntry {
  return {
    timestamp: new Date(Number(entry.unixNanos / NS_PER_MS)),
    line: entry.line,
    labels: entry.labels ?? {},
  };
}

/** Dashboard level string → LogLevel enum. */
function toProtoLevel(level?: DashboardLogLevel): LogLevel {
  switch (level) {
    case 'debug':
      return LogLevel.DEBUG;
    case 'info':
      return LogLevel.INFO;
    case 'warn':
      return LogLevel.WARN;
    case 'error':
      return LogLevel.ERROR;
    default:
      return LogLevel.UNSPECIFIED;
  }
}

export interface QueryLogsOptions {
  start?: Date;
  end?: Date;
  limit?: number;
}

/**
 * Returns the active tenant's log lines for a single mission. The tenant
 * scope is derived server-side from the authenticated identity, the caller
 * supplies only the mission id and an optional time-range / limit.
 */
export async function queryMissionLogs(
  missionId: string,
  options?: QueryLogsOptions,
): Promise<DashboardLogEntry[]> {
  const req = create(QueryMissionLogsRequestSchema, {
    missionId,
    startUnixNanos: options?.start ? dateToUnixNanos(options.start) : BigInt(0),
    endUnixNanos: options?.end ? dateToUnixNanos(options.end) : BigInt(0),
    limit: options?.limit ?? 0,
  });
  const resp = await userClient(LogsService).queryMissionLogs(req);
  return resp.entries.map(fromProtoEntry);
}

export interface QueryDaemonLogsOptions extends QueryLogsOptions {
  level?: DashboardLogLevel;
  missionId?: string;
}

/**
 * Returns the active tenant's daemon log lines, optionally filtered by level
 * and/or a mission-id substring. Tenant scope is derived server-side.
 */
export async function queryDaemonLogs(
  options?: QueryDaemonLogsOptions,
): Promise<DashboardLogEntry[]> {
  const req = create(QueryDaemonLogsRequestSchema, {
    level: toProtoLevel(options?.level),
    missionId: options?.missionId ?? '',
    startUnixNanos: options?.start ? dateToUnixNanos(options.start) : BigInt(0),
    endUnixNanos: options?.end ? dateToUnixNanos(options.end) : BigInt(0),
    limit: options?.limit ?? 0,
  });
  const resp = await userClient(LogsService).queryDaemonLogs(req);
  return resp.entries.map(fromProtoEntry);
}
