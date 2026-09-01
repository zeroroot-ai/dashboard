/**
 * The passes of a job node, per attempt (gibson#1706 lane E5, epic decision 12).
 *
 * The job node executor (gibson#1713) runs the verify loop inside one job:
 * the member works, the verifier judges, and on a fail the executor sends
 * the verifier's report as the next input to the same job. So the job's
 * event log holds the passes: every input from a component sender is a
 * verifier report that starts the next pass, and the close carries the
 * final verdict and score. A pass that got a report failed by definition;
 * the loop only continues on a fail. The last pass carries the verdict.
 */

import type { JobEventView, JobView, JobVerdictName } from "./view";

export interface Attempt {
  /** 1-based pass number. */
  pass: number;
  /** The verifier report that ended this pass, when one was sent. */
  report: string;
  /** failed: a report followed; the final pass takes the job verdict; pending while the job is open. */
  outcome: "failed" | "accomplished" | "abandoned" | "pending";
  /** The scorer's score, on the final pass of a closed job. */
  score: number | null;
}

function isVerifierReport(ev: JobEventView): boolean {
  return ev.kind === "input" && ev.input !== null && ev.input.kind === "turn" && ev.input.sender.kind === "component";
}

function finalOutcome(verdict: JobVerdictName): Attempt["outcome"] {
  if (verdict === "accomplished") return "accomplished";
  if (verdict === "abandoned") return "abandoned";
  return "failed";
}

/**
 * Derives the attempts of a job from the job and its event log. The count
 * is `job.attempts` when the daemon set it, else one more than the reports.
 */
export function deriveAttempts(job: Pick<JobView, "attempts" | "state" | "verdict" | "score">, events: readonly JobEventView[]): Attempt[] {
  const reports = events.filter(isVerifierReport).map((ev) => ev.input?.message ?? "");
  const count = Math.max(job.attempts, reports.length + 1, 1);
  const closed = job.state === "closed";
  const out: Attempt[] = [];
  for (let i = 0; i < count; i++) {
    const last = i === count - 1;
    const report = reports[i] ?? "";
    let outcome: Attempt["outcome"];
    if (!last || !closed) {
      outcome = report ? "failed" : last ? "pending" : "failed";
    } else {
      outcome = finalOutcome(job.verdict);
    }
    out.push({ pass: i + 1, report, outcome, score: last && closed ? job.score : null });
  }
  return out;
}

/** One line for a report: its first sentence or line, cut to a width. */
export function reportSummary(report: string, width = 160): string {
  const flat = report.replace(/\s+/g, " ").trim();
  if (flat.length === 0) return "";
  const sentence = /^(.+?[.!?])(\s|$)/.exec(flat)?.[1] ?? flat;
  return sentence.length > width ? sentence.slice(0, width - 1) + "…" : sentence;
}
