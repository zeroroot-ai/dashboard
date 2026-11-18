// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * AgentSkillGrants. A tenant admin grants an Agent Skill to one agent or to
 * one mission, and removes a grant. The page lists the present grants, each
 * with a Revoke button. The form picks an agent or a mission from a list. It
 * keeps a text field for an id that the list does not hold, and for the case
 * that a list does not load. Both calls are idempotent.
 */

import * as React from "react";
import { toast } from "sonner";

import {
  grantAgentSkillAction,
  listAgentSkillGrantsAction,
  listMissionOptionsAction,
  revokeAgentSkillAction,
} from "@/app/actions/agent-skills";
import { listAgentIdentitiesAction } from "@/app/actions/read/listAgentIdentities";
import { Button } from "@/components/ui/button";
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
  AgentSkillGrantDTO,
  AgentSkillSubjectKindDTO,
} from "@/src/lib/gibson-client/agent-skill-types";
import { AGENT_SKILL_TEXT as T } from "./texts";

interface Option {
  id: string;
  name: string;
}

const SELECT_CLASS =
  "border-input bg-background text-foreground focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none";

function kindText(kind: AgentSkillSubjectKindDTO): string {
  return kind === "agent" ? T.kindAgent : T.kindMission;
}

export function AgentSkillGrants({ name }: { name: string }) {
  const [kind, setKind] = React.useState<AgentSkillSubjectKindDTO>("agent");
  const [subjectId, setSubjectId] = React.useState("");
  const [typeId, setTypeId] = React.useState(false);
  const [agents, setAgents] = React.useState<Option[]>([]);
  const [missions, setMissions] = React.useState<Option[]>([]);
  const [grants, setGrants] = React.useState<AgentSkillGrantDTO[] | null>(null);
  const [grantsError, setGrantsError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    void listAgentSkillGrantsAction(name)
      .then((res) => {
        if (res.ok) {
          setGrants(res.data);
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
    // The pickers are a convenience. A failed list leaves the text field.
    void listAgentIdentitiesAction()
      .then((res) => {
        if (live && res.ok) setAgents(res.data);
      })
      .catch(() => undefined);
    void listMissionOptionsAction()
      .then((res) => {
        if (live && res.ok) setMissions(res.data);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const options = kind === "agent" ? agents : missions;
  const showText = typeId || options.length === 0;

  async function run(
    mode: "grant" | "revoke",
    target?: AgentSkillGrantDTO,
  ) {
    const k = target?.kind ?? kind;
    const id = target?.subjectId ?? subjectId;
    setBusy(true);
    setError(null);
    try {
      const act = mode === "grant" ? grantAgentSkillAction : revokeAgentSkillAction;
      const res = await act({ name, subjectKind: k, subjectId: id });
      if (!res.ok) {
        setError(res.code === "unauthenticated" ? T.sessionExpired : res.error);
        return;
      }
      toast.success(mode === "grant" ? T.granted : T.revoked);
      refresh();
    } catch {
      setError(mode === "grant" ? T.grantFailed : T.revokeFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{T.grantsPresent}</h3>
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
                <TableHead>{T.columnGrantKind}</TableHead>
                <TableHead>{T.columnGrantId}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((g) => (
                <TableRow key={`${g.kind}:${g.subjectId}`} data-testid="grant-row">
                  <TableCell>{kindText(g.kind)}</TableCell>
                  <TableCell className="font-mono text-xs break-all">{g.subjectId}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      aria-label={`${T.revokeButton} ${g.subjectId}`}
                      onClick={() => void run("revoke", g)}
                    >
                      {T.revokeButton}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <form
        aria-label={T.grantsTitle}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run("grant");
        }}
      >
        <p className="text-muted-foreground text-sm">{T.grantsIntro}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="grant-kind">{T.fieldSubjectKind}</Label>
            <select
              id="grant-kind"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value === "mission" ? "mission" : "agent");
                setSubjectId("");
              }}
              className={SELECT_CLASS}
            >
              <option value="agent">{T.kindAgent}</option>
              <option value="mission">{T.kindMission}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            {showText ? (
              <>
                <Label htmlFor="grant-subject">{T.fieldSubjectId}</Label>
                <Input
                  id="grant-subject"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  maxLength={255}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
              </>
            ) : (
              <>
                <Label htmlFor="grant-pick">{T.fieldSubjectPick}</Label>
                <select
                  id="grant-pick"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  required
                  className={SELECT_CLASS}
                >
                  <option value="">{T.pickerNone}</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name === o.id ? o.id : `${o.name} (${o.id})`}
                    </option>
                  ))}
                </select>
              </>
            )}
            {options.length > 0 ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => {
                  setTypeId((v) => !v);
                  setSubjectId("");
                }}
              >
                {showText ? T.pickerUseList : T.pickerEnterId}
              </Button>
            ) : null}
          </div>
        </div>
        {error ? (
          <p role="alert" data-testid="grant-error" className="text-destructive text-sm break-words">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={busy || subjectId.trim() === ""}>
          {T.grantButton}
        </Button>
      </form>
    </div>
  );
}
