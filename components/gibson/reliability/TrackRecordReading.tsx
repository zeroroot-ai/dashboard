// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * TrackRecordReading — one track record as the panels show it (gibson#619,
 * dashboard#192, ADR-0129 §3): the prior strength as a bar from 0 to 100%,
 * or the "no track record yet" state when no bet of the technique has
 * settled in the scope. The technique panel and the mission panel both
 * render their records through this one component.
 */

import * as React from 'react';

import { ErrorAlert } from '@/components/gibson/shared/ErrorAlert';
import type { TrackRecord } from '@/src/types/calibration';
import { TRACK_RECORD_TEXT } from './track-record-texts';

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

export function TrackRecordReading({
  record,
  error,
}: {
  record: TrackRecord | undefined;
  error: Error | null | undefined;
}) {
  return (
    <>
      {error && <ErrorAlert title={TRACK_RECORD_TEXT.loadFailed} error={error} />}

      {record && !record.hasTrackRecord && (
        <p className="text-sm" data-testid="track-record-none">
          {TRACK_RECORD_TEXT.noTrackRecord}
        </p>
      )}

      {record && record.hasTrackRecord && (
        <div className="space-y-1" data-testid="track-record-bar">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium uppercase tracking-wide text-muted-foreground">
              {TRACK_RECORD_TEXT.barLabel}
            </span>
            <span className="font-mono">{pct(record.priorStrength)}</span>
          </div>
          <div
            className="h-2 w-full rounded-full bg-muted"
            role="meter"
            aria-label={TRACK_RECORD_TEXT.barLabel}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(record.priorStrength * 100)}
          >
            <div
              className="h-2 rounded-full bg-highlight"
              style={{ width: pct(Math.min(Math.max(record.priorStrength, 0), 1)) }}
            />
          </div>
        </div>
      )}
    </>
  );
}
