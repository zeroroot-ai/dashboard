// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

'use client';

/**
 * TrackRecordPanel — the track record of one technique in one scope
 * (gibson#619, dashboard#192, ADR-0129 §3).
 *
 * The prior strength shows as a bar from 0 to 100%. When no bet of the
 * technique has settled in the scope, the panel says so instead of showing
 * the neutral prior as if it were a record.
 */

import * as React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorAlert } from '@/components/gibson/shared/ErrorAlert';
import { useTrackRecord, useWorldScopes } from '@/src/hooks/useTrackRecord';
import { TRACK_RECORD_TEXT } from './track-record-texts';

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

export function TrackRecordPanel({ technique }: { technique: string }) {
  const scopes = useWorldScopes();
  const [scopeId, setScopeId] = React.useState('');
  const scopeList = React.useMemo(() => scopes.data ?? [], [scopes.data]);

  React.useEffect(() => {
    if (scopeId === '' && scopeList.length > 0) setScopeId(scopeList[0]!);
  }, [scopeId, scopeList]);

  const record = useTrackRecord(technique, scopeId);

  return (
    <Card className="border-border" data-testid="track-record-panel">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{TRACK_RECORD_TEXT.title}</CardTitle>
        <p className="text-sm text-muted-foreground">{TRACK_RECORD_TEXT.intro}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {scopes.data && scopeList.length === 0 ? (
          <p className="text-sm" data-testid="track-record-no-scopes">
            {TRACK_RECORD_TEXT.noScopes}
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {TRACK_RECORD_TEXT.scopeLabel}
            </span>
            <Select value={scopeId} onValueChange={setScopeId}>
              <SelectTrigger className="w-64" data-testid="track-record-scope-select">
                <SelectValue placeholder={TRACK_RECORD_TEXT.scopePlaceholder} />
              </SelectTrigger>
              <SelectContent>
                {scopeList.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {(scopes.error || record.error) && (
          <ErrorAlert
            title={TRACK_RECORD_TEXT.loadFailed}
            error={(scopes.error ?? record.error) as Error}
          />
        )}

        {record.data && !record.data.hasTrackRecord && (
          <p className="text-sm" data-testid="track-record-none">
            {TRACK_RECORD_TEXT.noTrackRecord}
          </p>
        )}

        {record.data && record.data.hasTrackRecord && (
          <div className="space-y-1" data-testid="track-record-bar">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium uppercase tracking-wide text-muted-foreground">
                {TRACK_RECORD_TEXT.barLabel}
              </span>
              <span className="font-mono">{pct(record.data.priorStrength)}</span>
            </div>
            <div
              className="h-2 w-full rounded-full bg-muted"
              role="meter"
              aria-label={TRACK_RECORD_TEXT.barLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(record.data.priorStrength * 100)}
            >
              <div
                className="h-2 rounded-full bg-highlight"
                style={{ width: pct(Math.min(Math.max(record.data.priorStrength, 0), 1)) }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
