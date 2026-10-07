// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The track record panel (dashboard#192, gibson#619): the prior strength as
 * a bar, the "no track record yet" state, and a World with no scope.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/src/lib/auth/tenant', () => ({ useTenantId: () => 't1' }));

import { TrackRecordPanel } from '../TrackRecordPanel';
import { TRACK_RECORD_TEXT } from '../track-record-texts';

const fetchMock = vi.fn();

function respond(scopes: string[], record: { priorStrength: number; hasTrackRecord: boolean }) {
  fetchMock.mockImplementation(async (url: string) => {
    const body = url.startsWith('/api/world/scopes')
      ? { scopes }
      : { technique: 'T1190', scopeId: scopes[0], ...record };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TrackRecordPanel technique="T1190" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('TrackRecordPanel', () => {
  it('shows the prior strength as a bar in the first scope', async () => {
    respond(['scope-a', 'scope-b'], { priorStrength: 0.72, hasTrackRecord: true });
    renderPanel();
    const bar = await screen.findByTestId('track-record-bar');
    expect(bar).toHaveTextContent('72%');
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '72');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/world/reputation?technique=T1190&scope=scope-a',
      expect.anything(),
    );
  });

  it('states that no track record exists yet', async () => {
    respond(['scope-a'], { priorStrength: 0.5, hasTrackRecord: false });
    renderPanel();
    expect(await screen.findByTestId('track-record-none')).toHaveTextContent(
      TRACK_RECORD_TEXT.noTrackRecord,
    );
    expect(screen.queryByTestId('track-record-bar')).toBeNull();
  });

  it('states that the World holds no scope', async () => {
    respond([], { priorStrength: 0.5, hasTrackRecord: false });
    renderPanel();
    expect(await screen.findByTestId('track-record-no-scopes')).toHaveTextContent(
      TRACK_RECORD_TEXT.noScopes,
    );
  });
});
