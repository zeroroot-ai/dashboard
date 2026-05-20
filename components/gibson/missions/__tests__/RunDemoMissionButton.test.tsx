/**
 * Per-component contract test for RunDemoMissionButton.
 *
 * Verifies the one-click happy path: click → POST /api/missions/demo →
 * navigate to /dashboard/missions/[id]. Plus error toasts on failure and
 * disabled state while pending.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RunDemoMissionButton } from '../RunDemoMissionButton';

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    success: (msg: string) => mockToastSuccess(msg),
    error: (msg: string) => mockToastError(msg),
  },
}));

beforeEach(() => {
  mockPush.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
  vi.restoreAllMocks();
});

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('RunDemoMissionButton', () => {
  it('renders the default label', () => {
    mockFetchOnce(200, {});
    render(<RunDemoMissionButton />);
    expect(screen.getByRole('button')).toHaveTextContent(/Run demo mission/i);
  });

  it('POSTs to /api/missions/demo, fires a success toast, and navigates to the mission detail page', async () => {
    const fetchMock = mockFetchOnce(200, {
      success: true,
      missionId: 'm-demo-1',
      target: 'scanme.nmap.org',
    });

    render(<RunDemoMissionButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/missions/demo', {
        method: 'POST',
      });
    });
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith(
        expect.stringContaining('scanme.nmap.org'),
      );
    });
    expect(mockPush).toHaveBeenCalledWith('/dashboard/missions/m-demo-1');
  });

  it('shows a pending label while the request is in flight', async () => {
    let resolveFetch: (v: { ok: boolean; status: number; json: () => Promise<unknown> }) => void = () => {};
    const fetchPromise = new Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>(
      (resolve) => {
        resolveFetch = resolve;
      },
    );
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchPromise));

    render(<RunDemoMissionButton />);
    fireEvent.click(screen.getByRole('button'));

    // Pending label appears, button is disabled.
    await waitFor(() => {
      expect(screen.getByRole('button')).toHaveTextContent(/Starting demo/i);
    });
    expect(screen.getByRole('button')).toBeDisabled();

    // Resolve the request → state clears.
    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({ success: true, missionId: 'm-1', target: 'scanme.nmap.org' }),
    });
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
    });
  });

  it('surfaces the daemon affordance message on error', async () => {
    mockFetchOnce(429, {
      error: {
        class: 'resource_exhausted',
        message: 'quota exceeded',
        affordance: 'Wait for one of your running missions to complete, then retry.',
      },
    });

    render(<RunDemoMissionButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        'Wait for one of your running missions to complete, then retry.',
      );
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('surfaces a generic error when the response has no body', async () => {
    mockFetchOnce(500, null);

    render(<RunDemoMissionButton />);
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        expect.stringContaining('500'),
      );
    });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
