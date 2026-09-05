/** TimelineEvent as the dashboard reads it from /api/world (seq/kind/summary). */
export interface TickEvent {
  seq: number;
  kind: string;
  summary: string;
}

/** The Timeline event kind for an observed LLM completion (gibson brain/llm_call.go). */
const LLM_TICK_KIND = 'llm_call.observed';

/** The Timeline event kinds for Decider activity (gibson brain/decider.go). */
const DECISION_PREFIX = 'decision.';

/**
 * llmCallIdForEvent returns the CallID behind an LLM tick, or null when the event
 * is not an LLM completion or carries no resolvable call id. The daemon renders
 * each Timeline event's summary as its Go struct (`%+v`), so an `llm_call.observed`
 * tick embeds `CallID:<id>` — we read it from there rather than a (not-yet-present)
 * structured field, so the transcript link wires the existing GetLlmCall RPC with
 * no backend change. An empty CallID (`CallID: `) yields null → degrades gracefully.
 */
export function llmCallIdForEvent(event: TickEvent): string | null {
  if (event.kind !== LLM_TICK_KIND) return null;
  const m = /CallID:(\S+)/.exec(event.summary);
  return m ? m[1] : null;
}

/** isDecisionEvent reports whether a tick is Decider activity carrying rationale. */
export function isDecisionEvent(event: TickEvent): boolean {
  return event.kind.startsWith(DECISION_PREFIX);
}
