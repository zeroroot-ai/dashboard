// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * AgentSkillGrants. A tenant admin grants an Agent Skill to one agent or to
 * one mission, or removes that grant. Both calls are idempotent.
 */

import * as React from "react";
import { toast } from "sonner";

import { grantAgentSkillAction, revokeAgentSkillAction } from "@/app/actions/agent-skills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AGENT_SKILL_TEXT as T } from "./texts";

export function AgentSkillGrants({ name }: { name: string }) {
  const [kind, setKind] = React.useState<"agent" | "mission">("agent");
  const [subjectId, setSubjectId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run(mode: "grant" | "revoke") {
    setBusy(true);
    setError(null);
    try {
      const act = mode === "grant" ? grantAgentSkillAction : revokeAgentSkillAction;
      const res = await act({ name, subjectKind: kind, subjectId });
      if (!res.ok) {
        setError(res.code === "unauthenticated" ? T.sessionExpired : res.error);
        return;
      }
      toast.success(mode === "grant" ? T.granted : T.revoked);
    } catch {
      setError(mode === "grant" ? T.grantFailed : T.revokeFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
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
            onChange={(e) => setKind(e.target.value === "mission" ? "mission" : "agent")}
            className="border-input bg-background text-foreground focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
          >
            <option value="agent">{T.kindAgent}</option>
            <option value="mission">{T.kindMission}</option>
          </select>
        </div>
        <div className="space-y-1.5">
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
        </div>
      </div>
      {error ? (
        <p role="alert" data-testid="grant-error" className="text-destructive text-sm break-words">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          {T.grantButton}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || subjectId.trim() === ""}
          onClick={() => void run("revoke")}
        >
          {T.revokeButton}
        </Button>
      </div>
    </form>
  );
}
