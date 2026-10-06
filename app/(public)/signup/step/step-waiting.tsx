// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * SignupStepWaiting — the screen after the browser returns from the external
 * signup step.
 *
 * It polls the step state. While the step waits, it shows the waiting text.
 * When the step is done, it hands over to the provisioning panel, which waits
 * for the workspace and then sends the browser to /login. When the step
 * failed, it shows the failure text and a retry button that sends the browser
 * to the same step link again. Every text comes from config.
 */

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  finishSignupAfterStep,
  readSignupStepState,
} from "@/app/actions/signup";
import type { SignupStepText } from "@/src/lib/deployment-profile";
import { ProvisioningPanel } from "../provisioning-panel";

/** How often the page asks the daemon for the step state. */
const POLL_INTERVAL_MS = 3_000;

type View = "waiting" | "failed" | "provisioning";

interface SignupStepWaitingProps {
  attemptId: string;
  stepText: SignupStepText;
}

export function SignupStepWaiting({ attemptId, stepText }: SignupStepWaitingProps) {
  const [view, setView] = useState<View>("waiting");
  const [redirectOnSuccess, setRedirectOnSuccess] = useState("");
  const [tenantSlug, setTenantSlug] = useState<string | undefined>(undefined);

  const finish = useCallback(async () => {
    setView("provisioning");
    const result = await finishSignupAfterStep();
    if (result.ok && "redirect" in result) {
      setRedirectOnSuccess(result.redirect);
    } else if (!result.ok && result.code === "PROVISIONING_TIMEOUT") {
      // Non-fatal: the panel keeps polling with the live-readiness fallback.
      setTenantSlug(result.tenantSlug);
    }
  }, []);

  useEffect(() => {
    if (view !== "waiting") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const state = await readSignupStepState();
      if (cancelled) return;
      if (state === "done" || state === "none") {
        void finish();
        return;
      }
      if (state === "failed") {
        setView("failed");
        return;
      }
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [view, finish]);

  if (view === "provisioning") {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col items-center justify-center gap-6 px-4 py-12">
        <ProvisioningPanel
          attemptId={attemptId}
          redirectOnSuccess={redirectOnSuccess}
          tenantSlug={tenantSlug}
          onRetry={() => void finish()}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">{stepText.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {view === "failed" ? (
            <>
              <p className="text-sm text-destructive" role="alert">
                {stepText.failureText}
              </p>
              <Button asChild className="w-full">
                {/* A plain anchor: the route answers with a redirect to
                    another origin, which client-side navigation cannot follow. */}
                <a href="/signup/step/start">{stepText.retryLabel}</a>
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground" aria-busy="true" aria-live="polite">
              {stepText.waitingText}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
