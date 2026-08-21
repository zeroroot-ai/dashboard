/**
 * Fold-scrubber predicate for the knowledge-graph view (gibson#1105).
 *
 * The graph renders a server-side fold of the World (GetFrameAt) only while the
 * scrubber is open AND the head sits off the live tail. At the tail (or with the
 * scrubber closed, or no Timeline) it renders the live enriched graph instead.
 * Pure so the live/replay switch is unit-testable without a canvas.
 */
export function isScrubbing(
  timelineActive: boolean,
  total: number,
  seq: number,
): boolean {
  return timelineActive && total > 0 && seq < total;
}
