import 'server-only';

/**
 * Typed dashboard client for gibson.job.v1.JobService (gibson#1706, lane E3).
 *
 * Every call runs through `userClient` (Envoy + ext-authz). The job RPCs
 * name their object, so the registry gate forwards them after the tenant
 * floor and the daemon decides `can_send`, `can_close` and `can_read`
 * (dashboard#1176). Maps protos to the client-safe views in
 * `src/lib/jobs/view.ts`.
 */

import { timestampDate, type Timestamp } from '@bufbuild/protobuf/wkt';
import {
  DeliverableKind,
  InputKind,
  JobEventKind,
  JobService,
  JobState,
  JobVerdict,
  type Deliverable,
  type Input,
  type Job,
  type JobEvent,
  type JobSpec,
} from '@/src/gen/gibson/job/v1/job_pb';
import { Principal_Kind, type Principal } from '@/src/gen/gibson/common/v1/gibson_common_pb';
import { userClient } from '../gibson-client';
import type { PrincipalView } from '../banks/view';
import type {
  DeliverableKindName,
  DeliverableView,
  InputKindName,
  InputView,
  JobEventKindName,
  JobEventView,
  JobSpecView,
  JobStateName,
  JobVerdictName,
  JobView,
} from '../jobs/view';

function iso(ts: Timestamp | undefined): string | null {
  return ts ? timestampDate(ts).toISOString() : null;
}

function principalView(p: Principal | undefined): PrincipalView {
  if (!p) return { kind: 'unknown', id: '' };
  switch (p.kind) {
    case Principal_Kind.USER:
      return { kind: 'user', id: p.id };
    case Principal_Kind.TENANT:
      return { kind: 'tenant', id: p.id };
    case Principal_Kind.COMPONENT:
      return { kind: 'component', id: p.id };
    case Principal_Kind.SERVICE:
      return { kind: 'service', id: p.id };
    default:
      return { kind: 'unknown', id: p.id };
  }
}

function stateName(v: JobState): JobStateName {
  switch (v) {
    case JobState.OPEN:
      return 'open';
    case JobState.WORKING:
      return 'working';
    case JobState.WAITING:
      return 'waiting';
    case JobState.CLOSED:
      return 'closed';
    default:
      return 'unknown';
  }
}

function verdictName(v: JobVerdict): JobVerdictName {
  switch (v) {
    case JobVerdict.ACCOMPLISHED:
      return 'accomplished';
    case JobVerdict.FAILED:
      return 'failed';
    case JobVerdict.ABANDONED:
      return 'abandoned';
    default:
      return 'unspecified';
  }
}

function inputKindName(v: InputKind): InputKindName {
  switch (v) {
    case InputKind.TURN:
      return 'turn';
    case InputKind.ANSWER:
      return 'answer';
    case InputKind.WRAP_UP:
      return 'wrap_up';
    default:
      return 'unknown';
  }
}

function deliverableKindName(v: DeliverableKind): DeliverableKindName {
  switch (v) {
    case DeliverableKind.PUSH_BRANCH:
      return 'push_branch';
    case DeliverableKind.MERGE_REQUEST:
      return 'merge_request';
    case DeliverableKind.NONE:
      return 'none';
    default:
      return 'unknown';
  }
}

function eventKindName(v: JobEventKind): JobEventKindName {
  switch (v) {
    case JobEventKind.OPENED:
      return 'opened';
    case JobEventKind.INPUT:
      return 'input';
    case JobEventKind.STATE:
      return 'state';
    case JobEventKind.DELIVERABLE:
      return 'deliverable';
    case JobEventKind.CLOSED:
      return 'closed';
    default:
      return 'unknown';
  }
}

function deliverableView(d: Deliverable): DeliverableView {
  return { kind: deliverableKindName(d.kind), ref: d.ref, url: d.url };
}

function specView(s: JobSpec | undefined): JobSpecView {
  return {
    goal: s?.goal ?? '',
    repositories: (s?.repositories ?? []).map((r) => ({
      name: r.name,
      connectorRef: r.connectorRef,
      project: r.project,
      baseBranch: r.baseBranch,
      deliverable: deliverableKindName(r.deliverable),
    })),
    credentialNames: [...(s?.credentialNames ?? [])],
    inputs: [...(s?.inputs ?? [])],
    acceptance: s?.acceptance
      ? {
          verifierComponent: s.acceptance.verifierComponent,
          passingScore: s.acceptance.passingScore,
          maxPasses: s.acceptance.maxPasses,
        }
      : null,
    context: Object.fromEntries(
      Object.entries(s?.context ?? {}).flatMap(([k, v]) =>
        v.kind.case === 'stringValue' ? [[k, v.kind.value] as const] : [],
      ),
    ),
  };
}

function inputView(i: Input): InputView {
  // The grant never reaches a client: the daemon strips it and this view
  // has no field for it.
  return {
    id: i.id,
    jobId: i.jobId,
    message: i.message,
    sender: principalView(i.sender),
    kind: inputKindName(i.kind),
    sentAt: iso(i.sentAt),
  };
}

function toJobView(j: Job): JobView {
  return {
    id: j.id,
    bankId: j.bankId,
    memberId: j.memberId,
    state: stateName(j.state),
    spec: specView(j.spec),
    claudeSessionId: j.claudeSessionId,
    openedBy: principalView(j.openedBy),
    openedAt: iso(j.openedAt),
    lastInputAt: iso(j.lastInputAt),
    closedAt: iso(j.closedAt),
    verdict: verdictName(j.verdict),
    score: j.score,
    deliverables: j.deliverables.map(deliverableView),
    attempts: j.attempts,
  };
}

export function toJobEventView(e: JobEvent): JobEventView {
  return {
    seq: e.seq.toString(),
    occurredAt: iso(e.occurredAt),
    kind: eventKindName(e.kind),
    jobId: e.jobId,
    state: stateName(e.state),
    input: e.input ? inputView(e.input) : null,
    deliverable: e.deliverable ? deliverableView(e.deliverable) : null,
    verdict: verdictName(e.verdict),
    score: e.score,
    message: e.message,
  };
}

const PAGE_SIZE = 200;

interface ListJobsFilter {
  bankId?: string;
  memberId?: string;
  state?: JobStateName;
  pageToken?: string;
}

const STATE_FILTER: Readonly<Record<JobStateName, JobState>> = {
  open: JobState.OPEN,
  working: JobState.WORKING,
  waiting: JobState.WAITING,
  closed: JobState.CLOSED,
  unknown: JobState.UNSPECIFIED,
};

export async function listJobs(f: ListJobsFilter = {}): Promise<{ jobs: JobView[]; nextPageToken: string }> {
  const resp = await userClient(JobService).listJobs({
    bankId: f.bankId ?? '',
    memberId: f.memberId ?? '',
    state: f.state ? STATE_FILTER[f.state] : JobState.UNSPECIFIED,
    pageSize: PAGE_SIZE,
    pageToken: f.pageToken ?? '',
  });
  return { jobs: resp.jobs.map(toJobView), nextPageToken: resp.nextPageToken };
}

export async function getJob(jobId: string): Promise<JobView | null> {
  const resp = await userClient(JobService).getJob({ jobId });
  return resp.job ? toJobView(resp.job) : null;
}

/** Opens a job with a goal-only spec: a chat turn from the console. */
export async function openJob(bankId: string, memberId: string, goal: string): Promise<JobView | null> {
  const resp = await userClient(JobService).openJob({
    bankId,
    memberId,
    spec: { goal, repositories: [], credentialNames: [], inputs: [], context: {} },
  });
  return resp.job ? toJobView(resp.job) : null;
}

export async function sendInput(jobId: string, message: string, kind: 'turn' | 'answer'): Promise<InputView | null> {
  const resp = await userClient(JobService).sendInput({
    jobId,
    message,
    kind: kind === 'answer' ? InputKind.ANSWER : InputKind.TURN,
  });
  return resp.input ? inputView(resp.input) : null;
}

export async function closeJob(jobId: string, verdict: 'accomplished' | 'failed', score: number): Promise<JobView | null> {
  const resp = await userClient(JobService).closeJob({
    jobId,
    verdict: verdict === 'accomplished' ? JobVerdict.ACCOMPLISHED : JobVerdict.FAILED,
    score,
  });
  return resp.job ? toJobView(resp.job) : null;
}

/** Follows one job's events after `sinceSeq` until it closes or `signal` aborts. */
export function streamJobEvents(jobId: string, sinceSeq: bigint, signal: AbortSignal): AsyncIterable<JobEvent> {
  const iter = userClient(JobService).streamJobEvents({ jobId, sinceSeq }, { signal });
  return {
    async *[Symbol.asyncIterator]() {
      for await (const resp of iter) {
        if (resp.event) yield resp.event;
      }
    },
  };
}
