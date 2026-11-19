// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * PublishAgentSkillForm. The form takes a name, an OCI reference with a
 * digest and an optional registry secret. The registry secret is a choice
 * from the names of the tenant secrets. The form shows each error of the
 * daemon as text, so the publisher can fix the reference or the folder.
 */

import * as React from "react";

import { listSecretNamesAction } from "@/app/actions/read/listSecretNames";
import { publishAgentSkillAction } from "@/app/actions/agent-skills";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AgentSkillDTO } from "@/src/lib/gibson-client/agent-skill-types";
import { AGENT_SKILL_TEXT as T } from "./texts";

export function PublishAgentSkillForm({
  onPublished,
}: {
  onPublished: (entry: AgentSkillDTO | null, name: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [secret, setSecret] = React.useState("");
  const [secretNames, setSecretNames] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    void listSecretNamesAction()
      .then((res) => {
        if (live && res.ok) setSecretNames(res.data);
      })
      .catch(() => {
        // The list is a convenience. Without it, the form still publishes
        // with no registry secret.
      });
    return () => {
      live = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await publishAgentSkillAction({
        name,
        reference,
        registrySecret: secret,
      });
      if (!res.ok) {
        setError(res.code === "unauthenticated" ? T.sessionExpired : res.error);
        return;
      }
      onPublished(res.data, name.trim());
      setName("");
      setReference("");
      setSecret("");
    } catch {
      setError(T.publishFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={T.publishTitle}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="agent-skill-name">{T.fieldName}</Label>
          <Input
            id="agent-skill-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={64}
            required
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-skill-secret">{T.fieldRegistrySecret}</Label>
          <select
            id="agent-skill-secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="border-input bg-background text-foreground focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none"
          >
            <option value="">{T.registrySecretNone}</option>
            {secretNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <p className="text-muted-foreground text-xs">{T.registrySecretHelp}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="agent-skill-reference">{T.fieldReference}</Label>
        <Input
          id="agent-skill-reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder={T.referencePlaceholder}
          maxLength={1024}
          required
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </div>
      {error ? (
        <p role="alert" data-testid="publish-error" className="text-destructive text-sm break-words">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? T.publishing : T.publishButton}
      </Button>
    </form>
  );
}
