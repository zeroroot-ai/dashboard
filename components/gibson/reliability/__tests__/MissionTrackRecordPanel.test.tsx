// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The mission track record panel (dashboard#192, gibson#619): one record
 * per technique the mission used, read in the scope of that technique, the
 * "no technique yet" state, and the truncated note.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/src/lib/auth/tenant', () => ({ useTenantId: () => 't1' }));

import { MissionTrackRecordPanel } from '../MissionTrackRecordPanel';
import { TRACK_RECORD_TEXT } from '../track-record-texts';

const fetchMock = vi.fn();

type Row = { technique: string; scopeId: string };
type Record = { priorStrength: number; hasTrackRecord: boolean };

function respond(techniques: Row[], records: Record[], truncated = false) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/missions/')) {
      return new Response(JSON.stringify({ techniques, truncated }), { status: 200 });
    }
    const params = new URL(url, 'http://test.local').searchParams;
    const technique = params.get('technique');
    const scopeId = params.get('scope');
    const i = techniques.findIndex((t) => t.technique === technique && t.scopeId === scopeId);
    const body = { technique, scopeId, ...records[i] };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MissionTrackRecordPanel missionId="mission-42" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('MissionTrackRecordPanel', () => {
  it('reads each technique of the mission in its own scope', async () => {
    respond(
      [
        { technique: 'T1190', scopeId: 'scope-a' },
        { technique: 'T1021', scopeId: 'scope-b' },
      ],
      [
        { priorStrength: 0.72, hasTrackRecord: true },
        { priorStrength: 0.5, hasTrackRecord: false },
      ],
    );
    renderPanel();
    const bar = await screen.findByTestId('track-record-bar');
    expect(bar).toHaveTextContent('72%');
    expect(await screen.findByTestId('track-record-none')).toHaveTextContent(
      TRACK_RECORD_TEXT.noTrackRecord,
    );
    expect(screen.getAllByTestId('mission-technique')).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/missions/mission-42/techniques', expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/world/reputation?technique=T1190&scope=scope-a',
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/world/reputation?technique=T1021&scope=scope-b',
      expect.anything(),
    );
    expect(screen.queryByTestId('mission-track-record-truncated')).toBeNull();
  });

  it('states that no hypothesis names a technique yet', async () => {
    respond([], []);
    renderPanel();
    expect(await screen.findByTestId('mission-track-record-none')).toHaveTextContent(
      TRACK_RECORD_TEXT.noTechniques,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('notes a truncated read', async () => {
    respond([{ technique: 'T1190', scopeId: 'scope-a' }], [{ priorStrength: 0.6, hasTrackRecord: true }], true);
    renderPanel();
    expect(await screen.findByTestId('mission-track-record-truncated')).toHaveTextContent(
      TRACK_RECORD_TEXT.truncated,
    );
  });
});
