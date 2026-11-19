// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * AgentSkillDetail. The page of one Agent Skill: the SKILL.md body and the
 * file list of one digest, the version list, a line diff between two
 * digests, the grants, and the delete action.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  deleteAgentSkillAction,
  getAgentSkillAction,
  listAgentSkillVersionsAction,
} from "@/app/actions/agent-skills";
import { ErrorAlert } from "@/components/gibson/shared";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type {
  AgentSkillDTO,
  AgentSkillDetailDTO,
} from "@/src/lib/gibson-client/agent-skill-types";
import { diffLines, type LineDiffResult } from "@/src/lib/agent-skills/line-diff";
import { formatPublishedAt, shortDigest } from "@/src/lib/agent-skills/view";
import { AgentSkillBody } from "./AgentSkillBody";
import { AgentSkillGrants } from "./AgentSkillGrants";
import { LineDiffView } from "./LineDiffView";
import { AGENT_SKILL_TEXT as T } from "./texts";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const SELECT_CLASS =
  "border-input bg-background text-foreground focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 font-mono text-xs focus-visible:ring-[3px] focus-visible:outline-none";

type DetailRead =
  | { versions: AgentSkillDTO[]; detail: AgentSkillDetailDTO | null; digest: string }
  | { error: string };

/** One read of the version list and of one version. It sets no state. */
async function readDetail(name: string, digest: string): Promise<DetailRead> {
  try {
    const [v, d] = await Promise.all([
      listAgentSkillVersionsAction(name),
      getAgentSkillAction(name, digest),
    ]);
    if (!v.ok) return { error: v.error || T.detailLoadError };
    if (!d.ok) return { error: d.error || T.detailLoadError };
    return { versions: v.data, detail: d.data, digest };
  } catch {
    return { error: T.detailLoadError };
  }
}

export function AgentSkillDetail({ name }: { name: string }) {
  const router = useRouter();
  const [versions, setVersions] = React.useState<AgentSkillDTO[] | null>(null);
  const [detail, setDetail] = React.useState<AgentSkillDetailDTO | null>(null);
  const [shownDigest, setShownDigest] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [diff, setDiff] = React.useState<LineDiffResult | null>(null);
  const [diffError, setDiffError] = React.useState<string | null>(null);
  const [diffBusy, setDiffBusy] = React.useState(false);

  // apply stores one read. The mount effect hands it the result of the read,
  // so the effect sets no state before the read ends.
  const apply = React.useCallback((r: DetailRead) => {
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setError(null);
    setVersions(r.versions);
    setDetail(r.detail);
    setShownDigest(r.detail?.entry.digest ?? r.digest);
    // Start the diff form with the two newest versions.
    setTo((t) => t || r.versions[0]?.digest || "");
    setFrom((f) => f || r.versions[1]?.digest || "");
  }, []);

  const load = React.useCallback(
    (digest: string) => {
      void readDetail(name, digest).then(apply);
    },
    [name, apply],
  );

  React.useEffect(() => {
    void readDetail(name, "").then(apply);
  }, [name, apply]);

  async function compare() {
    setDiffBusy(true);
    setDiff(null);
    setDiffError(null);
    try {
      const [a, b] = await Promise.all([
        getAgentSkillAction(name, from),
        getAgentSkillAction(name, to),
      ]);
      if (!a.ok) return setDiffError(a.error);
      if (!b.ok) return setDiffError(b.error);
      if (!a.data || !b.data) return setDiffError(T.notFound);
      setDiff(diffLines(a.data.body, b.data.body));
    } catch {
      setDiffError(T.diffFailed);
    } finally {
      setDiffBusy(false);
    }
  }

  async function remove() {
    try {
      const res = await deleteAgentSkillAction(name);
      if (!res.ok) {
        toast.error(res.code === "unauthenticated" ? T.sessionExpired : res.error);
        return;
      }
      toast.success(T.deleted(name));
      router.push("/dashboard/agent-skills");
    } catch {
      toast.error(T.deleteFailed);
    }
  }

  const header = (
    <div className="space-y-2">
      <nav className="text-muted-foreground text-sm">
        <Link href="/dashboard/agent-skills" className="hover:text-foreground underline-offset-2 hover:underline">
          {T.back}
        </Link>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
    </div>
  );

  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorAlert error={{ message: error }} title={T.detailLoadError} retry={() => load(shownDigest)} />
      </div>
    );
  }
  if (versions === null) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-muted-foreground text-sm">{T.loading}</p>
      </div>
    );
  }
  if (detail === null) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-muted-foreground text-sm">{T.notFound}</p>
      </div>
    );
  }

  const e = detail.entry;
  const changed = diff?.ok ? diff.lines.some((l) => l.kind !== "same") : false;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        {header}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm">
              {T.deleteButton}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{T.deleteTitle}</AlertDialogTitle>
              <AlertDialogDescription>{T.deleteBody}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void remove()}>{T.deleteConfirm}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {T.detailsTitle}
            {e.current ? <Badge variant="success">{T.currentBadge}</Badge> : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>{e.description}</p>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{T.fieldDigestShown}</dt>
            <dd className="font-mono text-xs break-all">{e.digest}</dd>
            <dt className="text-muted-foreground">{T.fieldReferenceShown}</dt>
            <dd className="font-mono text-xs break-all">{e.reference}</dd>
            <dt className="text-muted-foreground">{T.columnPublished}</dt>
            <dd>{formatPublishedAt(e.publishedAt)}</dd>
            {e.license ? (
              <>
                <dt className="text-muted-foreground">{T.fieldLicense}</dt>
                <dd>{e.license}</dd>
              </>
            ) : null}
            {e.compatibility ? (
              <>
                <dt className="text-muted-foreground">{T.fieldCompatibility}</dt>
                <dd>{e.compatibility}</dd>
              </>
            ) : null}
            {e.allowedTools.length > 0 ? (
              <>
                <dt className="text-muted-foreground">{T.fieldAllowedTools}</dt>
                <dd className="font-mono text-xs">{e.allowedTools.join(", ")}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{T.bodyTitle}</CardTitle>
          <p className="text-muted-foreground text-xs">{T.bodyHelp}</p>
        </CardHeader>
        <CardContent>
          <AgentSkillBody key={e.digest} body={detail.body} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{T.filesTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {detail.files.length === 0 ? (
            <p className="text-muted-foreground text-sm">{T.filesEmpty}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.columnPath}</TableHead>
                  <TableHead>{T.columnSize}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.files.map((f) => (
                  <TableRow key={f.path} data-testid="file-row">
                    <TableCell className="font-mono text-xs">{f.path}</TableCell>
                    <TableCell>{formatBytes(f.sizeBytes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{T.versionsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {versions.length === 0 ? (
            <p className="text-muted-foreground text-sm">{T.versionsEmpty}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{T.columnDigest}</TableHead>
                  <TableHead>{T.columnPublished}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {versions.map((v) => (
                  <TableRow key={v.digest} data-testid="version-row">
                    <TableCell className="font-mono text-xs">
                      {shortDigest(v.digest)}{" "}
                      {v.current ? <Badge variant="success">{T.currentBadge}</Badge> : null}
                    </TableCell>
                    <TableCell>{formatPublishedAt(v.publishedAt)}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={v.digest === e.digest}
                        aria-label={`${T.viewVersion} ${shortDigest(v.digest)}`}
                        onClick={() => load(v.digest)}
                      >
                        {T.viewVersion}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {versions.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{T.diffTitle}</CardTitle>
            <p className="text-muted-foreground text-xs">{T.diffIntro}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="diff-from">{T.diffFrom}</Label>
                <select id="diff-from" value={from} onChange={(ev) => setFrom(ev.target.value)} className={SELECT_CLASS}>
                  {versions.map((v) => (
                    <option key={v.digest} value={v.digest}>
                      {shortDigest(v.digest)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="diff-to">{T.diffTo}</Label>
                <select id="diff-to" value={to} onChange={(ev) => setTo(ev.target.value)} className={SELECT_CLASS}>
                  {versions.map((v) => (
                    <option key={v.digest} value={v.digest}>
                      {shortDigest(v.digest)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <Button variant="outline" disabled={diffBusy || !from || !to} onClick={() => void compare()}>
              {T.diffButton}
            </Button>
            {diffError ? (
              <p role="alert" className="text-destructive text-sm break-words">
                {diffError}
              </p>
            ) : null}
            {diff && !diff.ok ? (
              <p data-testid="diff-too-large" className="text-muted-foreground text-sm">
                {T.diffTooLarge}
              </p>
            ) : null}
            {diff?.ok && !changed ? (
              <p data-testid="diff-same" className="text-muted-foreground text-sm">
                {T.diffSame}
              </p>
            ) : null}
            {diff?.ok && changed ? <LineDiffView lines={diff.lines} /> : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{T.grantsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentSkillGrants name={name} />
        </CardContent>
      </Card>
    </div>
  );
}
