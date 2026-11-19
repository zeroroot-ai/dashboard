// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * InboundMissionsContent. The page of the mission definitions that the tenant
 * published for inbound A2A calls: the publish form, the list with the
 * Unpublish action, and the callers of each publication. Each RPC needs the
 * tenant "admin" relation. The nav entry and the page hide from other roles,
 * and the daemon checks the relation again.
 *
 * The publish form makes a new identity for the caller. It offers no identity
 * that exists, so a caller never has a right other than this one grant.
 */

import * as React from "react";
import { toast } from "sonner";

import {
  listDefinitionAgentsAction,
  listInboundMissionsAction,
  listInboundPublishOptionsAction,
  publishInboundMissionAction,
  republishInboundMissionAction,
  unpublishInboundMissionAction,
} from "@/app/actions/inbound-missions";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { CredentialPanel, type Credentials } from "@/components/gibson/shared/CredentialPanel";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import type {
  InboundCallerFlowResult,
  InboundMissionDTO,
  InboundOptionDTO,
} from "@/src/lib/gibson-client/inbound-mission-types";
import { formatPublishedAt } from "@/src/lib/agent-skills/view";
import { CallerFlowFailure } from "./CallerFlowFailure";
import { InboundCallers } from "./InboundCallers";
import { INBOUND_MISSION_TEXT as T } from "./texts";

const SELECT_CLASS =
  "border-input bg-background text-foreground focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none";

/** The number of columns of the list. A row that spans the table uses it. */
const COLUMN_COUNT = 7;

type Failure = Extract<InboundCallerFlowResult, { ok: false }>;
type Options = { definitions: InboundOptionDTO[]; targets: InboundOptionDTO[] };
type AgentsRead = { loading: true } | { agents: string[] } | { error: string };

async function readAll(): Promise<InboundMissionDTO[] | { error: string }> {
  try {
    const res = await listInboundMissionsAction();
    return res.ok ? res.data : { error: res.error || T.loadError };
  } catch {
    return { error: T.loadError };
  }
}

async function readOptions(): Promise<Options | { error: string }> {
  try {
    const res = await listInboundPublishOptionsAction();
    return res.ok ? res.data : { error: res.error || T.optionsLoadError };
  } catch {
    return { error: T.optionsLoadError };
  }
}

async function readAgents(definitionName: string): Promise<AgentsRead> {
  try {
    const res = await listDefinitionAgentsAction(definitionName);
    return res.ok ? { agents: res.data } : { error: res.error || T.agentsLoadError };
  } catch {
    return { error: T.agentsLoadError };
  }
}

function nameOf(options: InboundOptionDTO[], id: string): string {
  return options.find((o) => o.id === id)?.name ?? id;
}

function PublishForm({ options, onPublished }: { options: Options; onPublished: (agent: string) => void }) {
  const [definitionId, setDefinitionId] = React.useState("");
  const [agents, setAgents] = React.useState<AgentsRead | null>(null);
  const [agent, setAgent] = React.useState("");
  const [targetIds, setTargetIds] = React.useState<string[]>([]);
  // The limit has no default. The admin must enter it.
  const [maxMissions, setMaxMissions] = React.useState("");
  const [callerName, setCallerName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failure, setFailure] = React.useState<Failure | null>(null);
  const [made, setMade] = React.useState<{ name: string; credentials: Credentials } | null>(null);

  function chooseDefinition(id: string) {
    setDefinitionId(id);
    setAgent("");
    if (id === "") {
      setAgents(null);
      return;
    }
    setAgents({ loading: true });
    void readAgents(nameOf(options.definitions, id)).then(setAgents);
  }

  function toggleTarget(id: string, on: boolean) {
    setTargetIds((prev) => (on ? [...prev.filter((t) => t !== id), id] : prev.filter((t) => t !== id)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const res = await publishInboundMissionAction({
        agent,
        missionDefinitionId: definitionId,
        targetIds,
        maxActiveMissions: Number(maxMissions),
        callerName,
      });
      if (!res.ok) {
        setFailure(res);
        // A failed grant leaves the publication in place, so the list changes.
        if (res.published) onPublished(agent);
        return;
      }
      setMade({ name: res.caller.name, credentials: res.credentials });
      onPublished(agent);
      setDefinitionId("");
      setAgents(null);
      setAgent("");
      setTargetIds([]);
      setMaxMissions("");
      setCallerName("");
    } catch {
      setFailure({ ok: false, error: T.publishFailed });
    } finally {
      setBusy(false);
    }
  }

  if (made) {
    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">{T.credentialsIntro}</p>
        <CredentialPanel
          credentials={made.credentials}
          title={T.credentialsTitle(made.name)}
          onAcknowledge={() => setMade(null)}
        />
      </div>
    );
  }

  const agentNames = agents && "agents" in agents ? agents.agents : [];
  const limit = Number(maxMissions);
  const ready =
    definitionId !== "" &&
    agent !== "" &&
    targetIds.length > 0 &&
    maxMissions.trim() !== "" &&
    Number.isInteger(limit) &&
    limit >= 1 &&
    callerName.trim() !== "";

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" aria-label={T.publishTitle}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="im-definition">{T.fieldDefinition}</Label>
          <select
            id="im-definition"
            value={definitionId}
            onChange={(e) => chooseDefinition(e.target.value)}
            required
            className={SELECT_CLASS}
          >
            <option value="">{T.definitionNone}</option>
            {options.definitions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          {options.definitions.length === 0 ? (
            <p className="text-muted-foreground text-xs">{T.noDefinitions}</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="im-agent">{T.fieldAgent}</Label>
          <select
            id="im-agent"
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            required
            disabled={agentNames.length === 0}
            className={SELECT_CLASS}
          >
            <option value="">{T.agentNone}</option>
            {agentNames.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          {agents && "loading" in agents ? (
            <p className="text-muted-foreground text-xs">{T.agentsLoading}</p>
          ) : agents && "error" in agents ? (
            <p role="alert" data-testid="agents-load-error" className="text-destructive text-xs">
              {agents.error}
            </p>
          ) : agents && agentNames.length === 0 ? (
            <p data-testid="agents-empty" className="text-muted-foreground text-xs">
              {T.noAgents}
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">{T.agentHelp}</p>
          )}
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{T.fieldTargets}</legend>
        <p className="text-muted-foreground text-xs">{T.targetsHelp}</p>
        {options.targets.length === 0 ? (
          <p data-testid="targets-empty" className="text-muted-foreground text-sm">
            {T.noTargets}
          </p>
        ) : (
          <div className="grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
            {options.targets.map((t) => (
              <div key={t.id} className="flex items-center gap-2">
                <Checkbox
                  id={`im-target-${t.id}`}
                  checked={targetIds.includes(t.id)}
                  onCheckedChange={(v) => toggleTarget(t.id, v === true)}
                />
                <Label htmlFor={`im-target-${t.id}`} className="font-normal break-all">
                  {t.name}
                </Label>
              </div>
            ))}
          </div>
        )}
      </fieldset>

      <div className="max-w-md space-y-1.5">
        <Label htmlFor="im-max-missions">{T.fieldMaxMissions}</Label>
        <Input
          id="im-max-missions"
          type="number"
          inputMode="numeric"
          min={1}
          max={10000}
          step={1}
          value={maxMissions}
          onChange={(e) => setMaxMissions(e.target.value)}
          required
          autoComplete="off"
        />
        <p className="text-muted-foreground text-xs">{T.maxMissionsHelp}</p>
      </div>

      <div className="max-w-md space-y-1.5">
        <Label htmlFor="im-caller-name">{T.fieldCallerName}</Label>
        <Input
          id="im-caller-name"
          value={callerName}
          onChange={(e) => setCallerName(e.target.value)}
          maxLength={63}
          required
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
        <p className="text-muted-foreground text-xs">{T.callerNameHelp}</p>
      </div>

      {failure ? <CallerFlowFailure failure={failure} /> : null}
      <Button type="submit" disabled={busy || !ready}>
        {busy ? T.publishing : T.publishButton}
      </Button>
    </form>
  );
}

function PublicationRow({
  entry,
  options,
  onChanged,
}: {
  entry: InboundMissionDTO;
  options: Options | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [republishError, setRepublishError] = React.useState<string | null>(null);

  async function republish() {
    setRepublishError(null);
    try {
      const res = await republishInboundMissionAction({
        agent: entry.agent,
        missionDefinitionId: entry.missionDefinitionId,
        targetIds: entry.targetIds,
        maxActiveMissions: entry.maxActiveMissions,
      });
      if (!res.ok) {
        setRepublishError(res.code === "unauthenticated" ? T.sessionExpired : res.error);
        return;
      }
      toast.success(T.republished(entry.agent));
      onChanged();
    } catch {
      setRepublishError(T.republishFailed);
    }
  }

  async function unpublish() {
    try {
      const res = await unpublishInboundMissionAction(entry.agent);
      if (!res.ok) {
        toast.error(res.code === "unauthenticated" ? T.sessionExpired : res.error);
        return;
      }
      toast.success(T.unpublished(entry.agent));
      onChanged();
    } catch {
      toast.error(T.unpublishFailed);
    }
  }

  return (
    <>
      <TableRow data-testid="inbound-mission-row">
        <TableCell className="font-medium">
          <div className="flex items-center gap-2">
            {entry.agent}
            {entry.stale ? (
              <Badge variant="destructive" data-testid="stale-badge">
                {T.staleBadge}
              </Badge>
            ) : null}
          </div>
        </TableCell>
        <TableCell className="break-all">
          {nameOf(options?.definitions ?? [], entry.missionDefinitionId)}
        </TableCell>
        <TableCell className="max-w-md whitespace-normal">
          <ul>
            {entry.targetIds.map((id) => (
              <li key={id} className="break-all">
                {nameOf(options?.targets ?? [], id)}
              </li>
            ))}
          </ul>
        </TableCell>
        <TableCell data-testid="max-missions">{entry.maxActiveMissions}</TableCell>
        <TableCell className="font-mono text-xs break-all">{entry.publishedBy}</TableCell>
        <TableCell>{formatPublishedAt(entry.createdAt)}</TableCell>
        <TableCell>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              aria-expanded={open}
              aria-label={`${T.callersButton} ${entry.agent}`}
              onClick={() => setOpen((v) => !v)}
            >
              {T.callersButton}
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" aria-label={`${T.unpublishButton} ${entry.agent}`}>
                  {T.unpublishButton}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{T.unpublishTitle}</AlertDialogTitle>
                  <AlertDialogDescription>{T.unpublishBody}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void unpublish()}>{T.unpublishConfirm}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </TableCell>
      </TableRow>
      {entry.stale ? (
        <TableRow data-testid="stale-row">
          <TableCell colSpan={COLUMN_COUNT} className="whitespace-normal">
            <div role="alert" className="text-destructive space-y-2 text-sm">
              <p>{T.staleBody}</p>
              {entry.staleReason ? (
                <p data-testid="stale-reason" className="break-words">
                  {entry.staleReason}
                </p>
              ) : null}
              {republishError ? (
                <p data-testid="republish-error" className="break-words">
                  {republishError}
                </p>
              ) : null}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="outline" aria-label={`${T.republishButton} ${entry.agent}`}>
                    {T.republishButton}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{T.republishTitle}</AlertDialogTitle>
                    <AlertDialogDescription>{T.republishBody}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
                    <AlertDialogAction onClick={() => void republish()}>{T.republishConfirm}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
      {open ? (
        <TableRow>
          <TableCell colSpan={COLUMN_COUNT} className="bg-muted/30 whitespace-normal">
            <InboundCallers agent={entry.agent} />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

export function InboundMissionsContent() {
  const [entries, setEntries] = React.useState<InboundMissionDTO[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [options, setOptions] = React.useState<Options | { error: string } | null>(null);

  const apply = React.useCallback((r: Awaited<ReturnType<typeof readAll>>) => {
    if ("error" in r) {
      setError(r.error);
    } else {
      setError(null);
      setEntries(r);
    }
  }, []);

  const reload = React.useCallback(() => {
    setError(null);
    void readAll().then(apply);
  }, [apply]);

  const reloadOptions = React.useCallback(() => {
    setOptions(null);
    void readOptions().then(setOptions);
  }, []);

  React.useEffect(() => {
    void readAll().then(apply);
    void readOptions().then(setOptions);
  }, [apply]);

  const loadedOptions = options && !("error" in options) ? options : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{T.title}</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">{T.intro}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{T.publishTitle}</CardTitle>
          <CardDescription>{T.publishIntro}</CardDescription>
        </CardHeader>
        <CardContent>
          {options === null ? (
            <TableSkeleton />
          ) : "error" in options ? (
            <ErrorAlert error={{ message: options.error }} title={T.optionsLoadError} retry={reloadOptions} />
          ) : (
            <PublishForm
              options={options}
              onPublished={(agent) => {
                toast.success(T.published(agent));
                reload();
              }}
            />
          )}
        </CardContent>
      </Card>

      {error ? (
        <ErrorAlert error={{ message: error }} title={T.loadError} retry={reload} />
      ) : entries === null ? (
        <TableSkeleton />
      ) : entries.length === 0 ? (
        <p data-testid="inbound-missions-empty" className="text-muted-foreground text-sm">
          {T.empty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.columnAgent}</TableHead>
              <TableHead>{T.columnDefinition}</TableHead>
              <TableHead>{T.columnTargets}</TableHead>
              <TableHead>{T.columnMaxMissions}</TableHead>
              <TableHead>{T.columnPublishedBy}</TableHead>
              <TableHead>{T.columnCreated}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <PublicationRow key={e.agent} entry={e} options={loadedOptions} onChanged={reload} />
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
