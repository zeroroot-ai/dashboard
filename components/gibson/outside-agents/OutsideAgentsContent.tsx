// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * OutsideAgentsContent. The list page of the outside agents of the tenant,
 * with the form to register one. Each RPC needs the tenant "admin" relation.
 * The nav entry and the page hide from other roles, and the daemon checks the
 * relation again. The page shows each error of the daemon as text.
 */

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import { listOutsideAgentsAction, registerOutsideAgentAction } from "@/app/actions/outside-agents";
import { listSecretNamesAction } from "@/app/actions/read/listSecretNames";
import { ErrorAlert, TableSkeleton } from "@/components/gibson/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import type { OutsideAgentDTO } from "@/src/lib/gibson-client/outside-agent-types";
import { formatPublishedAt } from "@/src/lib/agent-skills/view";
import { OUTSIDE_AGENT_TEXT as T } from "./texts";

const SELECT_CLASS =
  "border-input bg-background text-foreground focus-visible:ring-ring/50 h-9 w-full rounded-md border px-3 text-sm focus-visible:ring-[3px] focus-visible:outline-none";

async function readAll(): Promise<OutsideAgentDTO[] | { error: string }> {
  try {
    const res = await listOutsideAgentsAction();
    return res.ok ? res.data : { error: res.error || T.loadError };
  } catch {
    return { error: T.loadError };
  }
}

function RegisterForm({ onRegistered }: { onRegistered: (name: string) => void }) {
  const [name, setName] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [credential, setCredential] = React.useState("");
  const [caBundle, setCaBundle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [secretNames, setSecretNames] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    // The list is a convenience. Without it, the form registers with no secret.
    void listSecretNamesAction()
      .then((res) => {
        if (live && res.ok) setSecretNames(res.data);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await registerOutsideAgentAction({
        name,
        a2aUrl: url,
        credentialSecret: credential,
        caBundleSecret: caBundle,
        description,
      });
      if (!res.ok) {
        setError(res.code === "unauthenticated" ? T.sessionExpired : res.error);
        return;
      }
      onRegistered(name.trim());
      setName("");
      setUrl("");
      setCredential("");
      setCaBundle("");
      setDescription("");
    } catch {
      setError(T.registerFailed);
    } finally {
      setBusy(false);
    }
  }

  const secretSelect = (id: string, value: string, set: (v: string) => void) => (
    <select id={id} value={value} onChange={(e) => set(e.target.value)} className={SELECT_CLASS}>
      <option value="">{T.secretNone}</option>
      {secretNames.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={T.registerTitle}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="oa-name">{T.fieldName}</Label>
          <Input
            id="oa-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={63}
            required
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <p className="text-muted-foreground text-xs">{T.nameHelp}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="oa-url">{T.fieldUrl}</Label>
          <Input
            id="oa-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={T.urlPlaceholder}
            maxLength={2048}
            required
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="oa-credential">{T.fieldCredential}</Label>
          {secretSelect("oa-credential", credential, setCredential)}
          <p className="text-muted-foreground text-xs">{T.credentialHelp}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="oa-ca">{T.fieldCaBundle}</Label>
          {secretSelect("oa-ca", caBundle, setCaBundle)}
          <p className="text-muted-foreground text-xs">{T.caBundleHelp}</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="oa-description">{T.fieldDescription}</Label>
        <Textarea
          id="oa-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={1024}
          rows={2}
        />
      </div>
      {error ? (
        <p role="alert" data-testid="register-error" className="text-destructive text-sm break-words">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? T.registering : T.registerButton}
      </Button>
    </form>
  );
}

export function OutsideAgentsContent() {
  const [agents, setAgents] = React.useState<OutsideAgentDTO[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const apply = React.useCallback((r: Awaited<ReturnType<typeof readAll>>) => {
    if ("error" in r) {
      setError(r.error);
    } else {
      setError(null);
      setAgents(r);
    }
  }, []);

  const reload = React.useCallback(() => {
    setError(null);
    void readAll().then(apply);
  }, [apply]);

  React.useEffect(() => {
    void readAll().then(apply);
  }, [apply]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{T.title}</h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">{T.intro}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{T.registerTitle}</CardTitle>
          <CardDescription>{T.registerIntro}</CardDescription>
        </CardHeader>
        <CardContent>
          <RegisterForm
            onRegistered={(name) => {
              toast.success(T.registered(name));
              reload();
            }}
          />
        </CardContent>
      </Card>

      {error ? (
        <ErrorAlert error={{ message: error }} title={T.loadError} retry={reload} />
      ) : agents === null ? (
        <TableSkeleton />
      ) : agents.length === 0 ? (
        <p data-testid="outside-agents-empty" className="text-muted-foreground text-sm">
          {T.empty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.columnName}</TableHead>
              <TableHead>{T.columnUrl}</TableHead>
              <TableHead>{T.columnDescription}</TableHead>
              <TableHead>{T.columnCreated}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((a) => (
              <TableRow key={a.name} data-testid="outside-agent-row">
                <TableCell className="font-medium">
                  <Link
                    href={`/dashboard/outside-agents/${encodeURIComponent(a.name)}`}
                    className="text-link underline-offset-2 hover:underline"
                  >
                    {a.name}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-xs break-all">{a.a2aUrl}</TableCell>
                <TableCell className="max-w-md whitespace-normal">{a.description}</TableCell>
                <TableCell>{formatPublishedAt(a.createdAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
