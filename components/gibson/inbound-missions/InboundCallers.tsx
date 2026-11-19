// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * InboundCallers. The callers of one published definition: the list, the
 * Revoke button of each caller, and the form that adds a new caller. A caller
 * is always a new identity. The form offers no identity that exists.
 *
 * Revoke asks first and says what it does: it removes the grant, and the
 * identity stays with its token (owner decision). This page does not revoke
 * an identity of a caller.
 */

import * as React from "react";
import { toast } from "sonner";

import {
  addInboundCallerAction,
  listInboundCallersAction,
  revokeInboundCallerAction,
} from "@/app/actions/inbound-missions";
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
  InboundCallerDTO,
  InboundCallerFlowResult,
} from "@/src/lib/gibson-client/inbound-mission-types";
import { CallerFlowFailure } from "./CallerFlowFailure";
import { INBOUND_MISSION_TEXT as T } from "./texts";

type Failure = Extract<InboundCallerFlowResult, { ok: false }>;

export function InboundCallers({ agent }: { agent: string }) {
  const [callers, setCallers] = React.useState<InboundCallerDTO[] | null>(null);
  const [callersCut, setCallersCut] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [revokeError, setRevokeError] = React.useState<string | null>(null);
  const [failure, setFailure] = React.useState<Failure | null>(null);
  const [made, setMade] = React.useState<{ name: string; credentials: Credentials } | null>(null);

  const refresh = React.useCallback(() => {
    void listInboundCallersAction(agent)
      .then((res) => {
        if (res.ok) {
          setCallers(res.data.items);
          setCallersCut(res.data.truncated);
          setLoadError(null);
        } else {
          setLoadError(res.error || T.callersLoadError);
        }
      })
      .catch(() => setLoadError(T.callersLoadError));
  }, [agent]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  async function revoke(identityId: string) {
    setBusy(true);
    setRevokeError(null);
    try {
      const res = await revokeInboundCallerAction({ agent, identityId });
      if (!res.ok) {
        setRevokeError(res.code === "unauthenticated" ? T.sessionExpired : res.error);
        return;
      }
      toast.success(T.revoked);
      refresh();
    } catch {
      setRevokeError(T.revokeFailed);
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFailure(null);
    try {
      const res = await addInboundCallerAction({ agent, callerName: name });
      if (!res.ok) {
        setFailure(res);
        return;
      }
      setMade({ name: res.caller.name, credentials: res.credentials });
      toast.success(T.callerAdded(res.caller.name));
      setName("");
      refresh();
    } catch {
      setFailure({ ok: false, error: T.addCallerFailed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={T.callersTitle(agent)} className="space-y-4" data-testid="inbound-callers">
      <div>
        <h3 className="text-sm font-medium">{T.callersTitle(agent)}</h3>
        <p className="text-muted-foreground text-sm">{T.callersIntro}</p>
      </div>

      {callers !== null && callersCut ? (
        <p role="status" data-testid="callers-cut" className="text-muted-foreground text-sm">
          {T.callersCut(callers.length)}
        </p>
      ) : null}
      {loadError ? (
        <p role="alert" data-testid="callers-load-error" className="text-destructive text-sm">
          {loadError}
        </p>
      ) : callers === null ? (
        <p className="text-muted-foreground text-sm">{T.callersLoading}</p>
      ) : callers.length === 0 ? (
        <p data-testid="callers-empty" className="text-muted-foreground text-sm">
          {T.callersEmpty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{T.columnCaller}</TableHead>
              <TableHead>{T.columnIdentityId}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {callers.map((c) => (
              <TableRow key={c.identityId} data-testid="caller-row">
                <TableCell>{c.name || T.unknownCaller}</TableCell>
                <TableCell className="font-mono text-xs break-all">{c.identityId}</TableCell>
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        aria-label={`${T.revokeButton} ${c.name || c.identityId}`}
                      >
                        {T.revokeButton}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{T.revokeTitle(c.name || c.identityId)}</AlertDialogTitle>
                        <AlertDialogDescription>{T.revokeBody}</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{T.cancel}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => void revoke(c.identityId)}>
                          {T.revokeConfirm}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {revokeError ? (
        <p role="alert" data-testid="revoke-error" className="text-destructive text-sm break-words">
          {revokeError}
        </p>
      ) : null}

      {made ? (
        <CredentialPanel
          credentials={made.credentials}
          title={T.credentialsTitle(made.name)}
          onAcknowledge={() => setMade(null)}
        />
      ) : (
        <form aria-label={T.addCallerButton} className="space-y-3" onSubmit={(e) => void add(e)}>
          <div className="max-w-md space-y-1.5">
            <Label htmlFor={`im-add-caller-${agent}`}>{T.fieldCallerName}</Label>
            <Input
              id={`im-add-caller-${agent}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={63}
              required
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <p className="text-muted-foreground text-xs">{T.callerNameHelp}</p>
          </div>
          {failure ? <CallerFlowFailure failure={failure} /> : null}
          <Button type="submit" variant="outline" disabled={busy || name.trim() === ""}>
            {busy ? T.addingCaller : T.addCallerButton}
          </Button>
        </form>
      )}
    </section>
  );
}
