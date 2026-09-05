import 'server-only';

/**
 * Typed dashboard client methods for the daemon-mediated read-only agent
 * console, gibson.daemon.agentconsole.v1.AgentConsoleService (ADR-0016 S12,
 * dashboard#1134, gibson#1599).
 *
 * The service is a pure READ surface. It has no input/write path: it lists the
 * caller-tenant's currently running agent instances and streams each one's
 * live structured output by run id. The daemon derives the tenant scope
 * server-side from the authenticated identity, so the dashboard never supplies
 * a tenant and the result never includes another tenant's instances. A run id
 * the tenant does not own returns NOT_FOUND, never data. The isolation
 * boundary is enforced daemon-side; the dashboard never re-filters.
 *
 * These wrappers call `userClient(AgentConsoleService)` so every call flows
 * dashboard -> Envoy (JWT + SPIFFE mTLS) -> daemon, exactly like every other
 * daemon RPC (mirrors LogsService in gibson-client/logs.ts). There is no
 * direct daemon gRPC channel.
 */

import { userClient } from '../gibson-client';
import {
  AgentConsoleService,
  type AgentEvent,
} from '@/src/gen/gibson/daemon/agentconsole/v1/agentconsole_pb';

/**
 * A running agent instance in the active tenant, mapped from the proto
 * `RunningAgent`. `startedUnixNanos` is narrowed to an ISO-8601 string so the
 * shape is JSON-safe for the browser (a proto int64 arrives as a `bigint`,
 * which does not survive `JSON.stringify`).
 */
export interface RunningAgentView {
  /** Unique id of the running instance within the tenant. Stream handle. */
  runId: string;
  /** The dispatched agent's name. */
  agentName: string;
  /** The setec sandbox backing this run (operator diagnostics). */
  sandboxId: string;
  /** Start time as an ISO-8601 string, from the proto's Unix-nanos field. */
  startedAt: string;
  /** The mission this run serves. Empty for a run outside a mission. */
  missionId: string;
  /** The mission run this run serves. Empty for a run outside a mission. */
  missionRunId: string;
  /**
   * The setec SandboxClass the run was launched under (ADR-0016 decision 4).
   * It names the isolation posture, so a viewer sees what confines a run.
   */
  sandboxClass: string;
  /**
   * What kind of component is running: "agent" or "tool". Both run in
   * sandboxes and both appear here, so the wall labels them.
   */
  componentKind: string;
}

const NS_PER_MS = BigInt(1_000_000);

/** Proto Unix-nanos bigint -> ISO-8601 string. */
function unixNanosToISO(nanos: bigint): string {
  return new Date(Number(nanos / NS_PER_MS)).toISOString();
}

/**
 * Returns the active tenant's currently running agent instances, sorted by
 * start time (the daemon sorts; the dashboard preserves that order). The
 * tenant scope is derived server-side from the authenticated identity; the
 * caller supplies nothing.
 */
export async function listRunningAgents(): Promise<RunningAgentView[]> {
  const resp = await userClient(AgentConsoleService).listRunningAgents({});
  return resp.agents.map((a) => ({
    runId: a.runId,
    agentName: a.agentName,
    sandboxId: a.sandboxId,
    startedAt: unixNanosToISO(a.startedUnixNanos),
    missionId: a.missionId,
    missionRunId: a.missionRunId,
    sandboxClass: a.sandboxClass,
    componentKind: a.componentKind,
  }));
}

/**
 * Opens the daemon's server-stream of one running instance's live structured
 * event chunks by run id, and returns the raw {@link AgentEvent} async
 * iterable. The stream ends when the run reaches a terminal state, or when the
 * passed `signal` aborts (browser disconnect). A run id the tenant does not
 * own throws `ConnectError(NotFound)`.
 *
 * The daemon does not parse the chunk bytes; the caller reassembles the
 * opencode NDJSON. This wrapper does no buffering, it hands each chunk through
 * as the daemon relays it.
 */
/**
 * Streams one run's events. `sinceSeq` is the last event sequence the caller
 * saw: the daemon replays its backlog after it, then follows live, with no
 * gap and no duplicate. Zero means the whole backlog (dashboard#1148).
 */
export function streamAgentEvents(
  runId: string,
  sinceSeq: bigint,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
  return userClient(AgentConsoleService).streamAgentEvents(
    { runId, sinceSeq },
    { signal },
  );
}
