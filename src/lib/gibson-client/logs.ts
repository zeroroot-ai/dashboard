// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

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
interface DashboardLogEntry {
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

interface QueryLogsOptions {
  start?: Date;
  end?: Date;
  /**
   * Maximum number of entries to return in total. The client walks pages
   * until it has this many, the daemon has no more, or LOG_MAX_PAGES pages
   * were read. Omit it to read one page of the daemon default size.
   */
  limit?: number;
}

/** Largest page the daemon accepts (page_size is capped at 1000). */
export const LOG_MAX_PAGE_SIZE = 1000;

/** Bound on pages read for one call, so a caller can never loop without end. */
export const LOG_MAX_PAGES = 5;

interface LogPage {
  entries: LogEntry[];
  nextPageToken: string;
}

/**
 * Reads pages with page_token until `limit` entries are in hand, the daemon
 * returns an empty next_page_token, or LOG_MAX_PAGES pages were read.
 * With no limit it reads exactly one page of the daemon default size.
 */
async function collectPages(
  fetchPage: (pageSize: number, pageToken: string) => Promise<LogPage>,
  limit?: number,
): Promise<DashboardLogEntry[]> {
  const want = limit && limit > 0 ? limit : 0;
  const out: DashboardLogEntry[] = [];
  let pageToken = '';
  for (let page = 0; page < LOG_MAX_PAGES; page++) {
    const remaining = want > 0 ? want - out.length : 0;
    const pageSize = Math.min(remaining, LOG_MAX_PAGE_SIZE);
    const resp = await fetchPage(pageSize, pageToken);
    for (const entry of resp.entries) out.push(fromProtoEntry(entry));
    pageToken = resp.nextPageToken ?? '';
    if (want === 0 || out.length >= want || pageToken === '') break;
  }
  return want > 0 ? out.slice(0, want) : out;
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
  return collectPages(async (pageSize, pageToken) => {
    const req = create(QueryMissionLogsRequestSchema, {
      missionId,
      startUnixNanos: options?.start ? dateToUnixNanos(options.start) : BigInt(0),
      endUnixNanos: options?.end ? dateToUnixNanos(options.end) : BigInt(0),
      pageSize,
      pageToken,
    });
    return userClient(LogsService).queryMissionLogs(req);
  }, options?.limit);
}

interface QueryDaemonLogsOptions extends QueryLogsOptions {
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
  return collectPages(async (pageSize, pageToken) => {
    const req = create(QueryDaemonLogsRequestSchema, {
      level: toProtoLevel(options?.level),
      missionId: options?.missionId ?? '',
      startUnixNanos: options?.start ? dateToUnixNanos(options.start) : BigInt(0),
      endUnixNanos: options?.end ? dateToUnixNanos(options.end) : BigInt(0),
      pageSize,
      pageToken,
    });
    return userClient(LogsService).queryDaemonLogs(req);
  }, options?.limit);
}
