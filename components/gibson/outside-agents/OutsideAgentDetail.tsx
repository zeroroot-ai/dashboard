// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * OutsideAgentDetail. The page of one outside agent: its record, the missions
 * that have a grant, a form to grant a mission with a picker and a text field
 * for an id that the list does not hold, and the delete action. A mission with
 * no grant is refused at the gateway.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  deleteOutsideAgentAction,
  getOutsideAgentAction,
  grantOutsideAgentAction,
  listOutsideAgentGrantsAction,
  revokeOutsideAgentAction,
} from "@/app/actions/outside-agents";
import { listMissionOptionsAction } from "@/app/actions/agent-skills";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OutsideAgentDTO } from "@/src/lib/gibson-client/outside-agent-types";
import { formatPublishedAt } from "@/src/lib/agent-skills/view";
import { OUTSIDE_AGENT_TEXT as T } from "./texts";

const SELECT_CLASS =
  "border-input bg-background text-foreground focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none";

type DetailRead = { agent: OutsideAgentDTO | null } | { error: string };

async function readDetail(name: string): Promise<DetailRead> {
  try {
    const res = await getOutsideAgentAction(name);
    return res.ok ? { agent: res.data } : { error: res.error || T.detailLoadError };
  } catch {
    return { error: T.detailLoadError };
  }
}

function Grants({ name }: { name: string }) {
  const [grants, setGrants] = React.useState<string[] | null>(null);
  const [grantsCut, setGrantsCut] = React.useState(false);
  const [grantsError, setGrantsError] = React.useState<string | null>(null);
  const [missions, setMissions] = React.useState<{ id: string; name: string }[]>([]);
  const [missionId, setMissionId] = React.useState("");
  const [typeId, setTypeId] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    void listOutsideAgentGrantsAction(name)
      .then((res) => {
        if (res.ok) {
          setGrants(res.data.items);
          setGrantsCut(res.data.truncated);
          setGrantsError(null);
        } else {
          setGrantsError(res.error || T.grantsLoadError);
        }
      })
      .catch(() => setGrantsError(T.grantsLoadError));
  }, [name]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  React.useEffect(() => {
    let live = true;
    // The picker is a convenience. A failed list leaves the text field.
    void listMissionOptionsAction()
      .then((res) => {
        if (live && res.ok) setMissions(res.data);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const showText = typeId || missions.length === 0;

  async function run(mode: "grant" | "revoke", id: string) {
    setBusy(true);
    setError(null);
    try {
      const act = mode === "grant" ? grantOutsideAgentAction : revokeOutsideAgentAction;
      const res = await act({ name, missionId: id });
      if (!res.ok) {
        setError(res.code === "unauthenticated" ? T.sessionExpired : res.error);
        return;
      }
      toast.success(mode === "grant" ? T.granted : T.revoked);
      if (mode === "grant") setMissionId("");
      refresh();
    } catch {
      setError(mode === "grant" ? T.grantFailed : T.revokeFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {grants !== null && grantsCut ? (
        <p role="status" data-testid="grants-cut" className="text-muted-foreground text-sm">
          {T.grantsCut(grants.length)}
        </p>
      ) : null}
      {grantsError ? (
        <p role="alert" data-testid="grants-load-error" className="text-destructive text-sm">
          {grantsError}
        </p>
      ) : grants === null ? (
        <p className="text-muted-foreground text-sm">{T.loading}</p>
      ) : grants.length === 0 ? (
        <p data-testid="grants-empty" className="text-muted-foreground text-sm">
          {T.grantsEmpty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.columnMission}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants.map((id) => (
              <TableRow key={id} data-testid="grant-row">
                <TableCell className="font-mono text-xs break-all">{id}</TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    aria-label={`${T.revokeButton} ${id}`}
                    onClick={() => void run("revoke", id)}
                  >
                    {T.revokeButton}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <form
        aria-label={T.grantsTitle}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run("grant", missionId);
        }}
      >
        <p className="text-muted-foreground text-sm">{T.grantsIntro}</p>
        <div className="max-w-md space-y-1.5">
          {showText ? (
            <>
              <Label htmlFor="oa-mission-id">{T.fieldMissionId}</Label>
              <Input
                id="oa-mission-id"
                value={missionId}
                onChange={(e) => setMissionId(e.target.value)}
                maxLength={255}
                required
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </>
          ) : (
            <>
              <Label htmlFor="oa-mission-pick">{T.fieldMissionPick}</Label>
              <select
                id="oa-mission-pick"
                value={missionId}
                onChange={(e) => setMissionId(e.target.value)}
                required
                className={SELECT_CLASS}
              >
                <option value="">{T.pickerNone}</option>
                {missions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name === m.id ? m.id : `${m.name} (${m.id})`}
                  </option>
                ))}
              </select>
            </>
          )}
          {missions.length > 0 ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => {
                setTypeId((v) => !v);
                setMissionId("");
              }}
            >
              {showText ? T.pickerUseList : T.pickerEnterId}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" data-testid="grant-error" className="text-destructive text-sm break-words">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || missionId.trim() === ""}>
          {T.grantButton}
        </Button>
      </form>
    </div>
  );
}

export function OutsideAgentDetail({ name }: { name: string }) {
  const router = useRouter();
  const [state, setState] = React.useState<DetailRead | null>(null);

  const load = React.useCallback(() => {
    void readDetail(name).then(setState);
  }, [name]);

  React.useEffect(() => {
    void readDetail(name).then(setState);
  }, [name]);

  async function remove() {
    try {
      const res = await deleteOutsideAgentAction(name);
      if (!res.ok) {
        toast.error(res.code === "unauthenticated" ? T.sessionExpired : res.error);
        return;
      }
      toast.success(T.deleted(name));
      router.push("/dashboard/outside-agents");
    } catch {
      toast.error(T.deleteFailed);
    }
  }

  const header = (
    <div className="space-y-2">
      <nav className="text-muted-foreground text-sm">
        <Link href="/dashboard/outside-agents" className="hover:text-foreground underline-offset-2 hover:underline">
          {T.back}
        </Link>
      </nav>
      <h1 className="text-2xl font-semibold tracking-tight break-words">{name}</h1>
    </div>
  );

  if (state === null) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-muted-foreground text-sm">{T.loading}</p>
      </div>
    );
  }
  if ("error" in state) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorAlert error={{ message: state.error }} title={T.detailLoadError} retry={load} />
      </div>
    );
  }
  if (state.agent === null) {
    return (
      <div className="space-y-6">
        {header}
        <p className="text-muted-foreground text-sm">{T.notFound}</p>
      </div>
    );
  }
  const a = state.agent;

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
          <CardTitle className="text-base">{T.detailsTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {a.description ? <p className="break-words whitespace-pre-wrap">{a.description}</p> : null}
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
            <dt className="text-muted-foreground">{T.columnUrl}</dt>
            <dd className="font-mono text-xs break-all">{a.a2aUrl}</dd>
            <dt className="text-muted-foreground">{T.fieldCredential}</dt>
            <dd className="font-mono text-xs">{a.credentialSecret || T.none}</dd>
            <dt className="text-muted-foreground">{T.fieldCaBundle}</dt>
            <dd className="font-mono text-xs">{a.caBundleSecret || T.none}</dd>
            <dt className="text-muted-foreground">{T.fieldCreated}</dt>
            <dd>{formatPublishedAt(a.createdAt)}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{T.grantsTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <Grants name={name} />
        </CardContent>
      </Card>
    </div>
  );
}
