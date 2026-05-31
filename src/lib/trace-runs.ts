import type { TraceSummary } from "@/src/types/trace";

/**
 * A "run" is a mission execution: one or more traces sharing a sessionId.
 * The daemon sets sessionId = mission id on a run's traces; when a trace has
 * no sessionId we treat it as its own singleton run, so grouping degrades
 * gracefully and is never wrong — only coarser when sessions aren't recorded.
 *
 * This is a pure presentation grouping over the trace list payload (no extra
 * fetch). Per-run $ cost is not derivable from the list (needs per-call model
 * info), so a run carries token totals as the spend proxy; the dollar
 * breakdown lives on the run view's Spend tab (dashboard#534).
 */
export interface TraceRun {
  /** Stable run id — the sessionId, or the lone trace id for singletons. */
  id: string;
  /** Human label for the run (session id, or the trace name for singletons). */
  label: string;
  /** Whether this run groups multiple traces under a shared session. */
  isSession: boolean;
  /** Agent names involved, parsed from `agent:<name>` trace tags. */
  agents: string[];
  totalTokens: number;
  /** error if ANY trace in the run errored. */
  status: "ok" | "error";
  /** Most recent trace timestamp in the run (ISO string). */
  latestTimestamp: string;
  /** The run's traces, newest first. */
  traces: TraceSummary[];
}

function agentFromTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const m = /^agent:(.+)$/.exec(tag);
    if (m && m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Group a flat, newest-first trace list into runs by sessionId. Run order
 * follows each run's most recent trace; traces within a run stay newest-first.
 */
export function groupTracesIntoRuns(traces: TraceSummary[]): TraceRun[] {
  const order: string[] = [];
  const byKey = new Map<string, TraceSummary[]>();

  for (const trace of traces) {
    const key = trace.sessionId || trace.id;
    const existing = byKey.get(key);
    if (existing) {
      existing.push(trace);
    } else {
      byKey.set(key, [trace]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const group = byKey.get(key)!;
    const isSession = !!group[0].sessionId;
    const agents = new Set<string>();
    let totalTokens = 0;
    let status: "ok" | "error" = "ok";
    let latestTimestamp = group[0].timestamp;

    for (const t of group) {
      for (const a of agentFromTags(t.tags)) agents.add(a);
      totalTokens += t.totalTokens;
      if (t.status === "error") status = "error";
      if (t.timestamp > latestTimestamp) latestTimestamp = t.timestamp;
    }

    const sorted = [...group].sort((a, b) =>
      a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
    );

    return {
      id: key,
      label: isSession ? key : group[0].name || group[0].id,
      isSession,
      agents: [...agents],
      totalTokens,
      status,
      latestTimestamp,
      traces: sorted,
    };
  });
}
