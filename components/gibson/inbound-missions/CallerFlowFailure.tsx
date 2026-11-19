// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * CallerFlowFailure. The report of a caller flow that stopped. It states the
 * step that failed, the error of the daemon, and each thing that the flow made
 * before it stopped: the identity and the publication. When the flow could not
 * revoke the identity that it made, the report shows the text of the daemon
 * and a button that sends the revoke again.
 */

import * as React from "react";
import { AlertTriangle } from "lucide-react";

import { retireAgentIdentityAction } from "@/app/actions/crd/member";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { InboundCallerFlowResult } from "@/src/lib/gibson-client/inbound-mission-types";
import { revokeCleanupNote } from "@/src/lib/inbound-missions/revoke-note";
import { INBOUND_MISSION_TEXT as T } from "./texts";

type Failure = Extract<InboundCallerFlowResult, { ok: false }>;

const STEP_TEXT = {
  identity: T.failedIdentity,
  publish: T.failedPublish,
  grant: T.failedGrant,
} as const;

type LeftIdentity = NonNullable<Failure["identity"]>;

/** An identity that the flow made and could not revoke, with the retry. */
function IdentityLeft({ identity }: { identity: LeftIdentity }) {
  const [busy, setBusy] = React.useState(false);
  const [revoked, setRevoked] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await retireAgentIdentityAction({ principalId: identity.identityId });
      if (res.ok) {
        setRevoked(true);
      } else {
        // The error of the revoke can hold proxy or transport text. Only the
        // cleanup message of the daemon shows, as its fixed note.
        setError(revokeCleanupNote(res.error) ?? T.retryRevokeFailed);
      }
    } catch {
      setError(T.retryRevokeFailed);
    } finally {
      setBusy(false);
    }
  }

  if (revoked) return <span data-testid="flow-identity-revoked">{T.identityRevokedNow(identity.name)}</span>;
  return (
    <div className="space-y-2">
      {identity.revokeNote ? (
        <>
          <p>{T.identityRevokeNote(identity.name, identity.identityId)}</p>
          <p data-testid="flow-revoke-note" className="break-words">
            {identity.revokeNote}
          </p>
        </>
      ) : (
        <p>{T.identityLeft(identity.name, identity.identityId)}</p>
      )}
      {error ? (
        <p role="alert" data-testid="flow-revoke-error" className="break-words">
          {error}
        </p>
      ) : null}
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void retry()}>
        {busy ? T.retryingRevoke : T.retryRevokeButton}
      </Button>
    </div>
  );
}

export function CallerFlowFailure({ failure }: { failure: Failure }) {
  const error = failure.code === "unauthenticated" ? T.sessionExpired : failure.error;
  // A refused input called nothing, so only the error shows.
  if (!failure.failedStep) {
    return (
      <p role="alert" data-testid="flow-error" className="text-destructive text-sm break-words">
        {error}
      </p>
    );
  }
  const identity = failure.identity;
  return (
    <Alert variant="destructive" data-testid="flow-failure">
      <AlertTriangle className="size-4" />
      <AlertTitle>{T.failureTitle}</AlertTitle>
      <AlertDescription>
        <p data-testid="flow-failed-step">{STEP_TEXT[failure.failedStep]}</p>
        <p data-testid="flow-error" className="break-words">
          {error}
        </p>
        <ul className="list-disc pl-5">
          <li data-testid="flow-identity-state">
            {!identity ? (
              T.identityNotMade
            ) : identity.removed ? (
              T.identityRemoved(identity.name)
            ) : (
              <IdentityLeft identity={identity} />
            )}
          </li>
          <li data-testid="flow-publication-state">
            {failure.published ? T.definitionPublished : T.definitionNotPublished}
          </li>
        </ul>
      </AlertDescription>
    </Alert>
  );
}
