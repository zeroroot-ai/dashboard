/**
 * Contract test for the mission detail page's Snapshot tab (gibson#1321).
 *
 * The tab this replaced rendered an always-empty checkpoint list, because
 * gibson#1117 removed the checkpoint store and left `ListCheckpoints` as a
 * hollow shell returning `[]` unconditionally. So the bar here is deliberately
 * higher than "the tab exists": these tests assert the tab is gated on a
 * WorldService permission that actually exists, and that selecting it mounts
 * the World playback view against THIS mission. An assertion that an empty
 * panel rendered would have passed against the bug.
 *
 * Mutation-checked (each of these turns the suite red):
 *   1. Delete the `useAuthorize(...)` call and render the trigger
 *      unconditionally -> "hides the Snapshot tab" fails, and the
 *      gate-target assertion fails.
 *   2. Repoint the gate at the retired
 *      "/gibson.daemon.v1.DaemonService/ListCheckpoints" -> the
 *      gate-target assertion fails.
 *   3. Render the tab content without passing `mission` / with `chrome="page"`
 *      -> the mount assertions fail.
 */

import * as React from 'react';
import { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockUseMission, mockUseAuthorize } = vi.hoisted(() => ({
  mockUseMission: vi.fn(),
  mockUseAuthorize: vi.fn(),
}));

vi.mock('@/src/hooks/useMissions', () => ({ useMission: mockUseMission }));
// The header's Live console link polls the running-agents list (dashboard#1145).
vi.mock('@/src/hooks/useRunningAgents', () => ({ useRunningAgents: () => ({ data: [] }) }));
vi.mock('@/src/lib/auth/use-authorize', () => ({
  useAuthorize: mockUseAuthorize,
}));

// The World playback view is exercised for real in
// components/gibson/brain/__tests__/BrainView.test.tsx. Here we only need to
// observe THAT it is mounted, and with which props.
vi.mock('@/components/gibson/brain/BrainView', () => ({
  BrainView: ({ mission, chrome }: { mission?: string; chrome?: string }) => (
    <div
      data-testid="world-snapshot"
      data-mission={mission ?? ''}
      data-chrome={chrome ?? ''}
    >
      world playback
    </div>
  ),
}));

// Sibling tabs are inert here; Radix unmounts inactive tab content anyway, but
// stubbing keeps their transitive deps (xterm, react-flow) out of jsdom.
vi.mock('@/components/gibson/missions/MissionFindingsTab', () => ({
  MissionFindingsTab: () => <div />,
}));
vi.mock('@/src/components/gibson/mission-graph/MissionFlowTab', () => ({
  MissionFlowTab: () => <div />,
}));
vi.mock('@/src/components/missions/SecretsAccessedPanel', () => ({
  SecretsAccessedPanel: () => <div />,
}));
vi.mock('@/src/components/mission/ToolStreamProgress', () => ({
  ToolStreamProgress: () => <div />,
}));
vi.mock('@/src/components/missions/MissionTerminal', () => ({
  MissionTerminal: () => <div />,
}));

import MissionDetailPage from '../page';

const MISSION_ID = 'mission-42';

const MISSION = {
  id: MISSION_ID,
  name: 'recon sweep',
  status: 'completed' as const,
  progress: 100,
  findings: 2,
  agents: [],
  config: {},
  missionDefinitionId: 'def-1',
  startedAt: undefined,
  completedAt: undefined,
};

/** The permission the Snapshot tab must be gated on. */
const SNAPSHOT_GATE = '/gibson.world.v1.WorldService/GetFrameAt';

/** The retired gate. It must not be consulted any more: gibson#1321 deletes it
 *  from the authz registry, and an unknown method fails closed, which would
 *  hide the tab from everyone. */
const RETIRED_GATE = '/gibson.daemon.v1.DaemonService/ListCheckpoints';

/**
 * The page reads its route params with `use(params)`, so the first render
 * suspends. Flush that inside an awaited `act` so every assertion below runs
 * against the real page rather than the Suspense fallback (an assertion made
 * against the fallback would pass for the wrong reason).
 */
async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <Suspense fallback={<div>loading</div>}>
        <MissionDetailPage params={Promise.resolve({ id: MISSION_ID })} />
      </Suspense>,
    );
  });
}

beforeEach(() => {
  mockUseMission.mockReset();
  mockUseAuthorize.mockReset();
  mockUseMission.mockReturnValue({
    data: MISSION,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseAuthorize.mockReturnValue({ allowed: true, loading: false });
});

describe('mission detail, Snapshot tab gating', () => {
  it('gates the tab on WorldService.GetFrameAt, not the retired checkpoint RPC', async () => {
    await renderPage();
    await screen.findByRole('tab', { name: /^Snapshot$/ });

    const gated = mockUseAuthorize.mock.calls.map((c) => c[0]);
    expect(gated).toContain(SNAPSHOT_GATE);
    expect(gated).not.toContain(RETIRED_GATE);
  });

  it('shows the Snapshot tab when the permission is granted', async () => {
    await renderPage();
    expect(
      await screen.findByRole('tab', { name: /^Snapshot$/ }),
    ).toBeInTheDocument();
  });

  it('hides the Snapshot tab when the permission is denied', async () => {
    mockUseAuthorize.mockReturnValue({ allowed: false, loading: false });
    await renderPage();

    // Wait for the page proper (not the Suspense fallback) before asserting
    // absence, otherwise the assertion passes against an unrendered tree.
    await screen.findByRole('tab', { name: /^Overview$/ });
    expect(
      screen.queryByRole('tab', { name: /^Snapshot$/ }),
    ).not.toBeInTheDocument();
  });

  it('hides the Snapshot tab while the permission check is in flight', async () => {
    mockUseAuthorize.mockReturnValue({ allowed: false, loading: true });
    await renderPage();

    await screen.findByRole('tab', { name: /^Overview$/ });
    expect(
      screen.queryByRole('tab', { name: /^Snapshot$/ }),
    ).not.toBeInTheDocument();
  });
});

describe('mission detail, Snapshot tab content', () => {
  it('mounts the World playback view scoped to this mission when selected', async () => {
    const user = userEvent.setup();
    await renderPage();

    const tab = await screen.findByRole('tab', { name: /^Snapshot$/ });

    // The panel is inactive on mount, so nothing should be mounted yet.
    expect(screen.queryByTestId('world-snapshot')).not.toBeInTheDocument();

    await user.click(tab);

    const view = await waitFor(() => screen.getByTestId('world-snapshot'));
    // Scoped to THIS mission. A tenant-wide mount would show every mission's
    // events on a page about one mission.
    expect(view).toHaveAttribute('data-mission', MISSION_ID);
    // Embedded chrome: the host page already renders the mission identity.
    expect(view).toHaveAttribute('data-chrome', 'embedded');
  });
});
