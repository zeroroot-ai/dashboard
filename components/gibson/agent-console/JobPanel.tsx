"use client";

/**
 * JobPanel, the imperative face of a bank member on the console
 * (gibson#1706 lane E3, epic decisions 11, 12, 18).
 *
 * Under a member's terminal: its open jobs (state chip, opened by, last
 * input), the selected job's events, and a compose box. With no job
 * selected the box opens a job with a goal-only spec. With a job selected it
 * sends the next turn. When the job waits with a question, the box becomes
 * the answer box. A principal that may close the job sees a Close action
 * that asks for a verdict and a score; the wrap-up shows as the final
 * events, then the job leaves the list.
 *
 * Gating follows the hook split: `can_send` and `can_close` are per-object
 * grants, so the panel derives what it can from the bank owner, the job
 * opener and the session (see src/lib/jobs/permissions.ts). The daemon
 * decides every call.
 */

import * as React from "react";
import { toast } from "sonner";
import { CheckIcon, Loader2, SendIcon, SquareCheckIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/src/lib/session-client";
import { useBankPermissions } from "@/src/hooks/useBankPermissions";
import { useCloseJob, useJobEvents, useJobs, useOpenJob, useSendInput } from "@/src/hooks/useJobs";
import { deriveJobPermissions } from "@/src/lib/jobs/permissions";
import { closeJobSchema } from "@/src/lib/jobs/schema";
import {
  JOB_VERDICT_LABEL,
  jobAcceptsInput,
  jobStateLabel,
  pendingQuestion,
  senderLabel,
  type JobEventView,
  type JobView,
} from "@/src/lib/jobs/view";
import type { MemberWithBankView } from "@/src/lib/banks/view";
import { formatDuration, shortId } from "@/src/lib/agent-console/stream-json";
import { cn } from "@/lib/utils";

const STATE_CLASS: Record<string, string> = {
  open: "border-border text-muted-foreground",
  working: "border-primary/50 bg-primary/10 text-primary",
  waiting: "border-alt/50 bg-alt/10 text-alt",
  closed: "border-border text-muted-foreground",
};

function JobStateChip({ state }: { state: JobView["state"] }) {
  return (
    <Badge variant="outline" className={cn("font-mono text-[0.65rem]", STATE_CLASS[state] ?? "")} data-testid="job-state" data-state={state}>
      {jobStateLabel(state)}
    </Badge>
  );
}

function ago(iso: string | null, now: number): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  return isNaN(t) ? "unknown" : `${formatDuration(Math.max(0, now - t))} ago`;
}

function eventLine(ev: JobEventView, myUserId: string | null): string {
  switch (ev.kind) {
    case "opened":
      return ev.message ? `opened · ${ev.message}` : "opened";
    case "input":
      return ev.input
        ? `${ev.input.kind} from ${senderLabel(ev.input.sender, myUserId)}: ${ev.input.message}`
        : "input";
    case "state":
      return `${jobStateLabel(ev.state)}${ev.message ? ` · ${ev.message}` : ""}`;
    case "deliverable":
      return ev.deliverable ? `${ev.deliverable.kind} ${ev.deliverable.ref} ${ev.deliverable.url}`.trim() : "deliverable";
    case "closed":
      return `closed ${JOB_VERDICT_LABEL[ev.verdict]} ${ev.score.toFixed(2)}${ev.message ? ` · ${ev.message}` : ""}`;
    default:
      return ev.message || ev.kind;
  }
}

interface JobPanelProps {
  member: MemberWithBankView;
  /** Compact for a wall tile, full for the pop-out. */
  compact?: boolean;
}

export function JobPanel({ member, compact = false }: JobPanelProps) {
  const { data: session } = useSession();
  const myUserId = session?.user.id ?? null;
  const bankPerms = useBankPermissions(member.bankOwner);
  const { data: jobs } = useJobs({ memberId: member.id });
  const openJobs = React.useMemo(() => (jobs ?? []).filter((j) => j.state !== "closed"), [jobs]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const selected = openJobs.find((j) => j.id === selectedId) ?? null;
  const feed = useJobEvents(selected ? selected.id : null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  // A job that closed leaves the list; drop the selection with it.
  React.useEffect(() => {
    if (selectedId && !openJobs.some((j) => j.id === selectedId)) setSelectedId(null);
  }, [openJobs, selectedId]);

  const jobPerms = selected ? deriveJobPermissions(selected.openedBy, bankPerms, myUserId) : null;
  const canCompose = selected ? jobPerms?.canSend === true : bankPerms.canSend;
  const question = selected?.state === "waiting" ? pendingQuestion(feed.events) ?? "The member waits for your answer." : null;

  return (
    <div
      data-testid="job-panel"
      data-member-id={member.id}
      className={cn("flex min-w-0 flex-col gap-2 border-t border-terminal-border bg-terminal p-2 font-mono text-xs text-terminal-muted", compact && "max-h-56")}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold text-terminal-fg">Jobs</span>
        <span>{openJobs.length} open</span>
        {selected ? (
          <Button type="button" variant="ghost" size="sm" className="ml-auto h-6 px-2 text-[0.65rem]" onClick={() => setSelectedId(null)} data-testid="job-deselect">
            all jobs
          </Button>
        ) : null}
      </div>

      {openJobs.length === 0 ? (
        <p data-testid="job-list-empty">No open job. Type a goal below to give this member one.</p>
      ) : (
        <ul data-testid="job-list" className="flex max-h-24 flex-col gap-1 overflow-y-auto">
          {openJobs.map((j) => (
            <li key={j.id}>
              <button
                type="button"
                data-testid="job-row"
                data-job-id={j.id}
                aria-pressed={j.id === selectedId}
                onClick={() => setSelectedId(j.id === selectedId ? null : j.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-1 py-0.5 text-left hover:bg-terminal-muted/10",
                  j.id === selectedId && "bg-terminal-muted/20 text-terminal-fg",
                )}
              >
                <JobStateChip state={j.state} />
                <span className="truncate" title={j.spec.goal}>{j.spec.goal || shortId(j.id)}</span>
                <span className="ml-auto shrink-0">by {senderLabel(j.openedBy, myUserId)}</span>
                <span className="shrink-0" title="last input">{ago(j.lastInputAt, now)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected ? (
        <div data-testid="job-events" className={cn("flex flex-col gap-0.5 overflow-y-auto", compact ? "max-h-16" : "max-h-48")}>
          {feed.events.length === 0 ? (
            <span>{feed.phase === "streaming" ? "waiting for events" : feed.phase}</span>
          ) : (
            feed.events.map((ev) => (
              <span key={ev.seq} data-testid="job-event" data-kind={ev.kind} className="truncate" title={eventLine(ev, myUserId)}>
                {eventLine(ev, myUserId)}
              </span>
            ))
          )}
        </div>
      ) : null}

      {canCompose && (!selected || jobAcceptsInput(selected.state)) ? (
        <ComposeBox
          key={selected ? `${selected.id}:${selected.state}` : "open"}
          member={member}
          job={selected}
          question={question}
        />
      ) : selected ? null : (
        <p data-testid="compose-denied">Ask the bank owner for can_send to give this member jobs.</p>
      )}

      {selected && jobPerms?.canClose && jobAcceptsInput(selected.state) ? (
        <CloseJobDialog job={selected} onClosed={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}

function ComposeBox({ member, job, question }: { member: MemberWithBankView; job: JobView | null; question: string | null }) {
  const [text, setText] = React.useState("");
  const open = useOpenJob();
  const send = useSendInput(job?.id ?? "");
  const pending = open.isPending || send.isPending;
  const answering = job !== null && job.state === "waiting";
  const placeholder = job
    ? answering
      ? "Answer the question"
      : "Send the next turn"
    : "Give this member a job: say what it must achieve";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || pending) return;
    if (!job) {
      open.mutate(
        { bankId: member.bankId, memberId: member.id, goal: message },
        {
          onSuccess: () => setText(""),
          onError: (err) => toast.error("Failed to open job", { description: err.message }),
        },
      );
      return;
    }
    send.mutate(
      { message, kind: answering ? "answer" : "turn" },
      {
        onSuccess: () => setText(""),
        onError: (err) => toast.error("Failed to send input", { description: err.message }),
      },
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1" data-testid={answering ? "answer-box" : job ? "turn-box" : "compose-box"}>
      {answering ? (
        <p className="text-alt" data-testid="pending-question">{question}</p>
      ) : null}
      <div className="flex items-end gap-1">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e);
            }
          }}
          rows={2}
          placeholder={placeholder}
          aria-label={placeholder}
          className="min-h-0 bg-terminal font-mono text-xs text-terminal-fg"
          data-testid="compose-input"
          disabled={pending}
        />
        <Button type="submit" size="icon" className="size-7 shrink-0" disabled={pending || text.trim() === ""} aria-label={answering ? "Send answer" : job ? "Send turn" : "Open job"} data-testid="compose-submit">
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : answering ? <CheckIcon className="size-3.5" /> : <SendIcon className="size-3.5" />}
        </Button>
      </div>
    </form>
  );
}

function CloseJobDialog({ job, onClosed }: { job: JobView; onClosed: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [verdict, setVerdict] = React.useState<"accomplished" | "failed">("accomplished");
  const [score, setScore] = React.useState("1");
  const [error, setError] = React.useState<string | null>(null);
  const close = useCloseJob(job.id);

  function submit() {
    const parsed = closeJobSchema.safeParse({ verdict, score });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid");
      return;
    }
    setError(null);
    close.mutate(parsed.data, {
      onSuccess: () => {
        toast.success(`Job ${shortId(job.id)} closed: ${verdict}`);
        setOpen(false);
        onClosed();
      },
      onError: (err) => toast.error("Failed to close job", { description: err.message }),
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="h-6 self-start px-2 text-[0.65rem]" onClick={() => setOpen(true)} data-testid="job-close-open">
        <SquareCheckIcon className="size-3" />
        Close job
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm" data-testid="job-close-dialog">
          <DialogHeader>
            <DialogTitle className="text-sm">Close job {shortId(job.id)}</DialogTitle>
            <DialogDescription className="text-xs">
              The member runs one wrap-up turn, performs the deliverables, removes its worktrees and archives the transcript. The worker never closes its own job.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              Verdict
              <Select value={verdict} onValueChange={(v) => setVerdict(v as "accomplished" | "failed")}>
                <SelectTrigger className="text-xs" aria-label="Verdict" data-testid="job-close-verdict">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="accomplished" className="text-xs">accomplished</SelectItem>
                  <SelectItem value="failed" className="text-xs">failed</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Score (0 to 1)
              <Input type="number" min={0} max={1} step={0.05} value={score} onChange={(e) => setScore(e.target.value)} className="font-mono text-xs" data-testid="job-close-score" />
            </label>
          </div>
          {error ? <p className="text-xs text-destructive" data-testid="job-close-error">{error}</p> : null}
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" className="text-xs" onClick={() => setOpen(false)} disabled={close.isPending}>
              Keep open
            </Button>
            <Button type="button" size="sm" className="text-xs" onClick={submit} disabled={close.isPending} data-testid="job-close-submit">
              {close.isPending ? <Loader2 className="size-3 animate-spin" /> : null}
              Close job
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
