/**
 * Client-safe view of jobs (gibson#1706, ADR-0019). The API routes map
 * `gibson.job.v1` protos to these shapes. State words match the published
 * docs: open, working, waiting, closed.
 */

import type { PrincipalView } from "@/src/lib/banks/view";

export type JobStateName = "open" | "working" | "waiting" | "closed" | "unknown";
export type JobVerdictName = "unspecified" | "accomplished" | "failed" | "abandoned";
export type InputKindName = "turn" | "answer" | "wrap_up" | "unknown";
export type DeliverableKindName = "push_branch" | "merge_request" | "none" | "unknown";
export type JobEventKindName = "opened" | "input" | "state" | "deliverable" | "closed" | "unknown";

export interface DeliverableView {
  kind: DeliverableKindName;
  ref: string;
  url: string;
}

export interface RepositoryView {
  name: string;
  connectorRef: string;
  project: string;
  baseBranch: string;
  deliverable: DeliverableKindName;
}

export interface AcceptanceView {
  verifierComponent: string;
  passingScore: number;
  maxPasses: number;
}

export interface JobSpecView {
  goal: string;
  repositories: RepositoryView[];
  credentialNames: string[];
  inputs: string[];
  acceptance: AcceptanceView | null;
}

export interface JobView {
  id: string;
  bankId: string;
  memberId: string;
  state: JobStateName;
  spec: JobSpecView;
  claudeSessionId: string;
  openedBy: PrincipalView;
  openedAt: string | null;
  lastInputAt: string | null;
  closedAt: string | null;
  verdict: JobVerdictName;
  score: number;
  deliverables: DeliverableView[];
  attempts: number;
}

export interface InputView {
  id: string;
  jobId: string;
  message: string;
  sender: PrincipalView;
  kind: InputKindName;
  sentAt: string | null;
}

export interface JobEventView {
  seq: string;
  occurredAt: string | null;
  kind: JobEventKindName;
  jobId: string;
  state: JobStateName;
  input: InputView | null;
  deliverable: DeliverableView | null;
  verdict: JobVerdictName;
  score: number;
  message: string;
}

/** The state chip text, in the docs' words. */
export function jobStateLabel(state: JobStateName): string {
  return state === "unknown" ? "unknown" : state;
}

export const JOB_VERDICT_LABEL: Readonly<Record<JobVerdictName, string>> = {
  unspecified: "open",
  accomplished: "accomplished",
  failed: "failed",
  abandoned: "abandoned",
};

/** True when the job accepts input from a client. */
export function jobAcceptsInput(state: JobStateName): boolean {
  return state === "open" || state === "working" || state === "waiting";
}

/** The question a waiting job asked, from its event log: the last non-input message before it entered waiting. */
export function pendingQuestion(events: readonly JobEventView[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev.kind === "input" || ev.kind === "closed") return null;
    if (ev.kind === "state" && ev.state === "waiting") return ev.message || "The member waits for your answer.";
  }
  return null;
}

/** Short sender text for an input row. */
export function senderLabel(p: PrincipalView, myUserId: string | null): string {
  if (p.kind === "user") return p.id === myUserId ? "me" : `user ${p.id}`;
  if (p.kind === "component") return `component ${p.id}`;
  if (p.kind === "service") return "platform";
  if (p.kind === "tenant") return "tenant";
  return p.id || "unknown";
}
