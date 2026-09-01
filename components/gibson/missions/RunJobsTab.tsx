"use client";

/**
 * RunJobsTab, what happened on a run's job nodes, per pass (gibson#1706
 * lane E5, epic decision 12): the attempts (pass N: verifier report
 * summary, outcome, score), the job id with a link to its member's console
 * pane, and the deliverables (branch, merge request URL).
 */

import * as React from "react";
import Link from "next/link";
import { ExternalLinkIcon, TerminalIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { consoleHref } from "@/components/gibson/agent-console/useLiveRun";
import { useJobEvents } from "@/src/hooks/useJobs";
import { useMemberRuns } from "@/src/hooks/useMemberRuns";
import { useRunJobs } from "@/src/hooks/useRunJobs";
import { deriveAttempts, reportSummary, type Attempt } from "@/src/lib/jobs/attempts";
import { JOB_VERDICT_LABEL, jobStateLabel, type JobView } from "@/src/lib/jobs/view";
import { shortId } from "@/src/lib/agent-console/stream-json";
import { cn } from "@/lib/utils";

const OUTCOME_CLASS: Record<Attempt["outcome"], string> = {
  accomplished: "border-primary/50 bg-primary/10 text-primary",
  failed: "border-destructive/50 bg-destructive/10 text-destructive",
  abandoned: "border-border text-muted-foreground",
  pending: "border-alt/50 bg-alt/10 text-alt",
};

function AttemptRow({ attempt }: { attempt: Attempt }) {
  return (
    <li className="flex flex-wrap items-center gap-2 py-1 text-xs" data-testid="attempt" data-pass={attempt.pass} data-outcome={attempt.outcome}>
      <span className="font-mono font-semibold">pass {attempt.pass}</span>
      <Badge variant="outline" className={cn("font-mono text-[0.65rem]", OUTCOME_CLASS[attempt.outcome])} data-testid="attempt-outcome">
        {attempt.outcome}
        {attempt.score !== null ? ` ${attempt.score.toFixed(2)}` : ""}
      </Badge>
      {attempt.report ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground" title={attempt.report} data-testid="attempt-report">
          {reportSummary(attempt.report)}
        </span>
      ) : null}
    </li>
  );
}

function RunJobCard({ job }: { job: JobView }) {
  const feed = useJobEvents(job.id);
  const memberRuns = useMemberRuns();
  const run = [...memberRuns.values()].find((m) => m.id === job.memberId);
  const attempts = deriveAttempts(job, feed.events);
  const nodeId = job.spec.context.node_id ?? "";
  return (
    <Card data-testid="run-job" data-job-id={job.id}>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono">{nodeId ? `node ${nodeId}` : "job node"}</span>
          <Badge variant="outline" className="font-mono text-[0.65rem]" data-testid="run-job-state">
            {job.state === "closed" ? JOB_VERDICT_LABEL[job.verdict] : jobStateLabel(job.state)}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground" title={job.id}>job {shortId(job.id)}</span>
          {run ? (
            <Link href={consoleHref(run.agentRunId)} className="ml-auto inline-flex items-center gap-1 text-xs text-link underline-offset-2 hover:underline" data-testid="run-job-console">
              <TerminalIcon className="size-3" aria-hidden="true" />
              Console
            </Link>
          ) : null}
        </CardTitle>
        {job.spec.goal ? <p className="text-xs text-muted-foreground">{job.spec.goal}</p> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <h5 className="mb-1 text-[0.65rem] uppercase tracking-wide text-muted-foreground">Attempts</h5>
          <ul className="divide-y divide-border" data-testid="attempts">
            {attempts.map((a) => <AttemptRow key={a.pass} attempt={a} />)}
          </ul>
        </div>
        <div>
          <h5 className="mb-1 text-[0.65rem] uppercase tracking-wide text-muted-foreground">Deliverables</h5>
          {job.deliverables.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="deliverables-empty">
              {job.state === "closed" ? "Nothing left the sandbox." : "None yet. They are performed at wrap-up."}
            </p>
          ) : (
            <ul className="space-y-1 text-xs" data-testid="deliverables">
              {job.deliverables.map((d, i) => (
                <li key={`${d.kind}-${d.ref}-${i}`} className="flex items-center gap-2" data-testid="deliverable" data-kind={d.kind}>
                  <Badge variant="outline" className="font-mono text-[0.65rem]">{d.kind.replace(/_/g, " ")}</Badge>
                  <span className="font-mono">{d.ref}</span>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-link underline-offset-2 hover:underline">
                      <ExternalLinkIcon className="size-3" aria-hidden="true" />
                      open
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function RunJobsTab({ missionId }: { missionId: string }) {
  const { data: jobs, isLoading, error } = useRunJobs(missionId);
  if (isLoading) return <TableSkeleton />;
  if (error) {
    return <ErrorAlert title="Could not load the run's jobs" error={error instanceof Error ? error : { message: String(error) }} />;
  }
  if (!jobs || jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="run-jobs-empty">
        This run opened no job. A job node opens one on a bank when the run reaches it.
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="run-jobs">
      {jobs.map((j) => <RunJobCard key={j.id} job={j} />)}
    </div>
  );
}
