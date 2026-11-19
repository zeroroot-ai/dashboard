// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * CallerFlowFailure. The report of a caller flow that stopped. It states the
 * step that failed, the error of the daemon, and each thing that the flow made
 * before it stopped: the identity and the publication.
 */

import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { InboundCallerFlowResult } from "@/src/lib/gibson-client/inbound-mission-types";
import { INBOUND_MISSION_TEXT as T } from "./texts";

type Failure = Extract<InboundCallerFlowResult, { ok: false }>;

const STEP_TEXT = {
  identity: T.failedIdentity,
  publish: T.failedPublish,
  grant: T.failedGrant,
} as const;

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
            {!identity
              ? T.identityNotMade
              : identity.removed
                ? T.identityRemoved(identity.name)
                : T.identityLeft(identity.name, identity.identityId)}
          </li>
          <li data-testid="flow-publication-state">
            {failure.published ? T.definitionPublished : T.definitionNotPublished}
          </li>
        </ul>
      </AlertDescription>
    </Alert>
  );
}
