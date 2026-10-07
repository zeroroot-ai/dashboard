// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * MissionTrackRecordPanel — the track record of each technique one mission
 * used, in the scope the mission used it in (gibson#619, dashboard#192,
 * ADR-0129 §3).
 *
 * A technique the mission used is a technique that one of the mission's
 * hypotheses names. The hypothesis also names its scope, so each row reads
 * WorldService.GetReputation for that technique in that scope. The rows
 * come from /api/missions/:id/techniques.
 */

import * as React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorAlert } from '@/components/gibson/shared/ErrorAlert';
import { TableSkeleton } from '@/components/gibson/shared';
import { useMissionTechniques, useTrackRecord } from '@/src/hooks/useTrackRecord';
import type { MissionTechnique } from '@/src/types/calibration';
import { TRACK_RECORD_TEXT } from './track-record-texts';
import { TrackRecordReading } from './TrackRecordReading';

function MissionTechniqueRecord({ technique, scopeId }: MissionTechnique) {
  const record = useTrackRecord(technique, scopeId);
  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="mission-technique">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-sm font-medium">{technique}</span>
        <span className="text-xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">{TRACK_RECORD_TEXT.scopeLabel}</span>{' '}
          <span className="font-mono">{scopeId}</span>
        </span>
      </div>
      <TrackRecordReading record={record.data} error={record.error} />
    </div>
  );
}

export function MissionTrackRecordPanel({ missionId }: { missionId: string }) {
  const techniques = useMissionTechniques(missionId);

  return (
    <Card className="border-border" data-testid="mission-track-record-panel">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{TRACK_RECORD_TEXT.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{TRACK_RECORD_TEXT.missionIntro}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {techniques.isLoading && <TableSkeleton rows={2} cols={1} />}

        {techniques.error && (
          <ErrorAlert title={TRACK_RECORD_TEXT.loadFailed} error={techniques.error} />
        )}

        {techniques.data && techniques.data.techniques.length === 0 && (
          <p className="text-sm" data-testid="mission-track-record-none">
            {TRACK_RECORD_TEXT.noTechniques}
          </p>
        )}

        {techniques.data?.techniques.map((t) => (
          <MissionTechniqueRecord
            key={`${t.technique}\u0000${t.scopeId}`}
            technique={t.technique}
            scopeId={t.scopeId}
          />
        ))}

        {techniques.data?.truncated && (
          <p className="text-xs text-muted-foreground" data-testid="mission-track-record-truncated">
            {TRACK_RECORD_TEXT.truncated}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
