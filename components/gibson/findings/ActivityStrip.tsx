// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

"use client";

/**
 * The activity strip of a finding (dashboard#393): each event of the finding
 * on the Timeline, in order, from the first evidence on. Each event links to
 * its replay frame. The head shows the exposure window of the finding split
 * into agent time and wait time. The Timeline has no time between two events
 * that it marks as agent time or wait time, so the split is for the whole
 * window.
 */

import * as React from "react";
import Link from "next/link";

import { ErrorAlert } from "@/components/gibson/shared/ErrorAlert";
import { TableSkeleton } from "@/components/gibson/shared/DataSkeleton";
import { useFindingActivity } from "@/src/hooks/useFindingActivity";
import { formatSeconds } from "@/src/lib/exposure/exposure";
import { replayHref } from "@/src/lib/findings/activity";
import { ACTIVITY_TEXT } from "./texts";

function localTime(iso: string): string {
  return iso ? new Date(iso).toLocaleString() : ACTIVITY_TEXT.timeUnknown;
}

export function ActivityStrip({ findingId }: { findingId: string }) {
  const { data, isLoading, error, refetch } = useFindingActivity(findingId);

  let body: React.ReactNode;
  if (isLoading) {
    body = <TableSkeleton rows={3} cols={2} />;
  } else if (error || !data) {
    body = (
      <ErrorAlert
        error={error ?? new Error(ACTIVITY_TEXT.loadFailed)}
        title={ACTIVITY_TEXT.loadFailed}
        retry={() => void refetch()}
      />
    );
  } else {
    body = (
      <>
        {data.exposure.found ? (
          <p className="text-sm" data-testid="activity-exposure">
            {data.exposure.verified ? ACTIVITY_TEXT.windowVerified : ACTIVITY_TEXT.windowOpen}:{" "}
            <span className="font-semibold tabular-nums">{formatSeconds(data.exposure.totalSeconds)}</span>.{" "}
            {ACTIVITY_TEXT.agentTime}: {formatSeconds(data.exposure.agentSeconds)}. {ACTIVITY_TEXT.waitTime}:{" "}
            {formatSeconds(data.exposure.waitSeconds)}.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="activity-no-exposure">
            {ACTIVITY_TEXT.noExposure}
          </p>
        )}
        {data.events.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="activity-empty">
            {ACTIVITY_TEXT.empty}
          </p>
        ) : (
          <ol className="space-y-1" data-testid="activity-events">
            {data.events.map((e) => (
              <li
                key={e.seq}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-1.5 text-sm"
                data-testid="activity-event"
              >
                <span>{e.label}</span>
                <span className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="tabular-nums" data-testid="activity-event-time">
                    {localTime(e.time)}
                  </span>
                  <Link
                    href={replayHref(e.seq)}
                    className="underline underline-offset-2 hover:text-highlight"
                    data-testid="activity-event-replay"
                  >
                    {ACTIVITY_TEXT.replay}
                  </Link>
                </span>
              </li>
            ))}
          </ol>
        )}
        {data.truncated && (
          <p className="text-xs text-muted-foreground" data-testid="activity-truncated">
            {ACTIVITY_TEXT.truncated}
          </p>
        )}
      </>
    );
  }

  return (
    <section className="space-y-3" data-testid="activity-strip" aria-labelledby="activity-heading">
      <h2 id="activity-heading" className="text-sm font-mono uppercase tracking-widest text-muted-foreground">
        {ACTIVITY_TEXT.title}
      </h2>
      {body}
    </section>
  );
}
