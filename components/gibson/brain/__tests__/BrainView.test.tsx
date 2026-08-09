/**
 * Render contract for BrainView, with emphasis on the embedded chrome the
 * mission detail page's Snapshot tab mounts (gibson#1321).
 *
 * The surface this replaced was an always-empty list, so the assertions here
 * are deliberately positive: they name rows that must be on screen and the
 * event count the Scroller must report. "Renders without throwing" would have
 * passed against the bug being fixed.
 *
 * Mutation-checked (each of these turns the suite red):
 *   1. Make /api/world/frame return an all-empty fold (EMPTY_FRAME, the shape
 *      the hollow checkpoint RPCs returned forever) -> the row assertions fail.
 *      Note the live /api/world read is kept deliberately disjoint from the
 *      fold, so this mutation cannot be masked by the pre-fold paint.
 *   2. Make /api/world return an empty timeline -> the "2 / 2 events"
 *      Scroller assertion fails.
 *   3. Drop the `mission` scoping from the frame fetch -> the
 *      "frame is fetched mission-scoped" assertion fails.
 *   4. Ignore `chrome` and always draw the page furniture -> the embedded
 *      chrome assertions fail.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// The force-directed canvas touches window/WebGL and is not what this test is
// about. frame -> table binding is.
vi.mock('@/components/gibson/brain/WorldGraph', () => ({
  WorldGraph: () => <div data-testid="world-graph" />,
}));

import { BrainView } from '../BrainView';

const MISSION_ID = 'mission-42';

const TIMELINE = [
  { seq: 0, kind: 'host.observed', summary: 'found 10.0.0.4' },
  { seq: 1, kind: 'finding.raised', summary: 'anonymous ftp' },
];

const FRAME = {
  seq: 2,
  total: 2,
  missions: [
    { id: MISSION_ID, goal: 'sweep the lab', status: 'completed', reason: 'done' },
  ],
  hosts: [
    {
      scopeId: 'lab',
      address: '10.0.0.4',
      openPorts: [21, 22],
      juicy: 0.9,
      attention: 0.8,
      surprise: '',
    },
  ],
  findings: [
    {
      id: 'f-1',
      title: 'anonymous ftp enabled',
      scopeId: 'lab',
      address: '10.0.0.4',
      severity: 'high',
    },
  ],
  work: [
    {
      id: 'w-1',
      missionId: MISSION_ID,
      kind: 'tool',
      target: 'nmap',
      status: 'done',
    },
  ],
  decisions: [
    {
      id: 'd-1',
      missionId: MISSION_ID,
      cursor: 1,
      status: 'completed',
      dispatches: [{ workId: 'w-1', kind: 'tool', target: 'nmap' }],
      outcome: 'ok',
      rationale: '',
    },
  ],
  llmCalls: [
    {
      callId: 'c-1',
      runId: 'r-1',
      model: 'claude-opus',
      scopeId: 'lab',
      promptTokens: 120,
      completionTokens: 30,
    },
  ],
};

/**
 * The live tenant-wide read. Deliberately DISJOINT from FRAME: BrainView paints
 * this first and only swaps in the server-side fold once the debounced
 * /api/world/frame request lands. Sharing values between the two would let a
 * frame assertion pass against the pre-fold render, which is precisely the
 * false-positive this suite has to avoid.
 */
const WORLD = {
  timeline: TIMELINE,
  missions: [
    { id: 'other', goal: 'unfolded goal', status: 'running', reason: '' },
  ],
  hosts: [
    {
      scopeId: 'lab',
      address: '192.168.1.1',
      openPorts: [8080],
      juicy: 0.1,
      attention: 0.1,
      surprise: '',
    },
  ],
  findings: [
    {
      id: 'f-live',
      title: 'unfolded finding',
      scopeId: 'lab',
      address: '192.168.1.1',
      severity: 'low',
    },
  ],
  work: [],
  decisions: [],
  llmCalls: [],
};

/** Records every URL BrainView fetched, so scoping can be asserted. */
let fetched: string[] = [];

function installFetch(
  overrides: { world?: unknown; frame?: unknown } = {},
): void {
  fetched = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      const body = url.startsWith('/api/world/frame')
        ? (overrides.frame ?? FRAME)
        : (overrides.world ?? WORLD);
      return {
        ok: true,
        status: 200,
        json: async () => body,
      } as Response;
    }),
  );
}

/**
 * Waits for text that can only come from the server-side fold. The frame fetch
 * is debounced (120 ms) and lands after the live paint, so these need more
 * headroom than the default 1 s findBy timeout allows under full-suite load.
 * The longer window never masks a wrong value, it only tolerates a slow one.
 */
const FOLD_TIMEOUT = { timeout: 15_000 };

function findFolded(text: string) {
  return screen.findByText(text, undefined, FOLD_TIMEOUT);
}

/** An all-empty fold, the shape the retired checkpoint RPCs returned forever. */
const EMPTY_FRAME = {
  seq: 0,
  total: 0,
  missions: [],
  hosts: [],
  findings: [],
  work: [],
  decisions: [],
  llmCalls: [],
};

beforeEach(() => {
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BrainView, embedded chrome (mission Snapshot tab)', () => {
  it('renders the mission state folded at the current tick, not an empty panel', async () => {
    render(<BrainView mission={MISSION_ID} chrome="embedded" />);

    // Targets, from the FOLDED frame. The address also appears in the Findings
    // table, so match the ports cell, which is unique to the host row.
    expect(await findFolded('21, 22')).toBeInTheDocument();
    expect(
      (await screen.findAllByText('10.0.0.4', undefined, FOLD_TIMEOUT)).length,
    ).toBeGreaterThan(0);
    // Findings, from the folded frame.
    expect(await findFolded('anonymous ftp enabled')).toBeInTheDocument();
    // Work, reconstructed as-of the tick.
    expect(await findFolded('nmap')).toBeInTheDocument();
    // LLM calls, folded to the tick.
    expect(await findFolded('claude-opus')).toBeInTheDocument();

    // The fold, not the live tenant-wide read, is what is on screen.
    expect(screen.queryByText('8080')).not.toBeInTheDocument();
    expect(screen.queryByText('unfolded finding')).not.toBeInTheDocument();

    // And the panels are genuinely populated rather than showing their
    // empty-state copy.
    expect(
      screen.queryByText('No hosts discovered yet.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('No findings yet.')).not.toBeInTheDocument();
    expect(screen.queryByText('No work in flight yet.')).not.toBeInTheDocument();
  });

  it('exposes the mission Timeline through the Scroller', async () => {
    render(<BrainView mission={MISSION_ID} chrome="embedded" />);

    // The scrub head follows the live tail, so both events are behind it.
    expect(await screen.findByText(/2 \/ 2 events/)).toBeInTheDocument();
    expect(await screen.findByText('host.observed')).toBeInTheDocument();
    expect(await screen.findByText('finding.raised')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Step forward one event/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Follow the live tail/i }),
    ).toBeInTheDocument();
  });

  it('folds the frame mission-scoped, not tenant-wide', async () => {
    render(<BrainView mission={MISSION_ID} chrome="embedded" />);
    await findFolded('21, 22');

    await waitFor(() => {
      expect(fetched.some((u) => u.startsWith('/api/world/frame'))).toBe(true);
    }, FOLD_TIMEOUT);
    for (const url of fetched) {
      expect(url).toContain(`mission=${MISSION_ID}`);
    }
  });

  it('drops the page furniture the host page already renders', async () => {
    render(<BrainView mission={MISSION_ID} chrome="embedded" />);
    await findFolded('21, 22');

    // The mission identity card duplicates the detail page header.
    expect(screen.queryByText('Viewing mission')).not.toBeInTheDocument();
    // The Missions table is a single redundant row on a per-mission page.
    expect(screen.queryByText('Missions')).not.toBeInTheDocument();
    expect(screen.queryByText('sweep the lab')).not.toBeInTheDocument();
    // Everything else survives.
    expect(screen.getByText('Targets')).toBeInTheDocument();
    expect(screen.getByText('Scroller')).toBeInTheDocument();
  });

  it('surfaces the empty state only when the fold really is empty', async () => {
    installFetch({ world: { ...WORLD, timeline: [] }, frame: EMPTY_FRAME });
    render(<BrainView mission={MISSION_ID} chrome="embedded" />);

    // The live read paints first, so wait for the empty fold to displace it.
    await waitFor(() => {
      expect(screen.getByText('No hosts discovered yet.')).toBeInTheDocument();
    }, FOLD_TIMEOUT);
    expect(screen.queryByText('8080')).not.toBeInTheDocument();
    expect(screen.queryByText('21, 22')).not.toBeInTheDocument();
    expect(screen.getByText('No events yet.')).toBeInTheDocument();
  });
});

describe('BrainView, page chrome (/world route)', () => {
  it('keeps the mission identity card and the Missions table', async () => {
    render(<BrainView mission={MISSION_ID} />);

    expect(await screen.findByText('Viewing mission')).toBeInTheDocument();
    expect(screen.getByText('Missions')).toBeInTheDocument();
    expect(await findFolded('sweep the lab')).toBeInTheDocument();
    expect(screen.queryByText('unfolded goal')).not.toBeInTheDocument();
  });
});
