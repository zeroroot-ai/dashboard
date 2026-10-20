// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * @vitest-environment node
 *
 * The shared page walker for the daemon list RPCs (ADR-0028).
 */

import { describe, it, expect, vi } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';

vi.mock('server-only', () => ({}));

import {
  DEFAULT_MAX_PAGES,
  MAX_PAGE_SIZE,
  isInvalidArgument,
  walkPages,
} from '../paging';

describe('walkPages', () => {
  it('follows next_page_token until it is empty', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], nextPageToken: 'a' })
      .mockResolvedValueOnce({ items: [3], nextPageToken: '' });

    const out = await walkPages(fetchPage);

    expect(out).toEqual({ items: [1, 2, 3], truncated: false });
    expect(fetchPage.mock.calls.map((c) => c[1])).toEqual(['', 'a']);
  });

  it('asks for the largest page when no limit is set', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [], nextPageToken: '' });
    await walkPages(fetchPage);
    expect(fetchPage.mock.calls[0][0]).toBe(MAX_PAGE_SIZE);
  });

  it('stops at the page bound and reports truncated', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [1], nextPageToken: 'more' });

    const out = await walkPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(DEFAULT_MAX_PAGES);
    expect(out.items).toHaveLength(DEFAULT_MAX_PAGES);
    expect(out.truncated).toBe(true);
  });

  it('stops at the limit, asks for the rows still missing and cuts the extra', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], nextPageToken: 'a' })
      .mockResolvedValueOnce({ items: [3, 4], nextPageToken: 'b' });

    const out = await walkPages(fetchPage, { limit: 3 });

    expect(out.items).toEqual([1, 2, 3]);
    expect(out.truncated).toBe(true);
    expect(fetchPage.mock.calls.map((c) => c[0])).toEqual([3, 1]);
  });

  it('never asks for more than the daemon maximum page size', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [], nextPageToken: '' });
    await walkPages(fetchPage, { limit: 5000 });
    expect(fetchPage.mock.calls[0][0]).toBe(MAX_PAGE_SIZE);
  });

  it('treats a missing next_page_token as the last page', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [1] });
    const out = await walkPages(fetchPage as never);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(out.truncated).toBe(false);
  });

  it('restarts once from the first page when restartOnce accepts the error', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1], nextPageToken: 'a' })
      .mockRejectedValueOnce(new ConnectError('bad token', Code.InvalidArgument))
      .mockResolvedValueOnce({ items: [7, 8], nextPageToken: '' });

    const out = await walkPages(fetchPage, { restartOnce: isInvalidArgument });

    expect(out.items).toEqual([7, 8]);
    expect(fetchPage.mock.calls.map((c) => c[1])).toEqual(['', 'a', '']);
  });

  it('restarts only once', async () => {
    const bad = new ConnectError('bad token', Code.InvalidArgument);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1], nextPageToken: 'a' })
      .mockRejectedValueOnce(bad)
      .mockResolvedValueOnce({ items: [2], nextPageToken: 'b' })
      .mockRejectedValueOnce(bad);

    await expect(
      walkPages(fetchPage, { restartOnce: isInvalidArgument }),
    ).rejects.toBe(bad);
  });

  it('does not restart on the first page, where no token was sent', async () => {
    const bad = new ConnectError('bad request', Code.InvalidArgument);
    const fetchPage = vi.fn().mockRejectedValue(bad);

    await expect(
      walkPages(fetchPage, { restartOnce: isInvalidArgument }),
    ).rejects.toBe(bad);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('rethrows an error that restartOnce does not accept', async () => {
    const down = new ConnectError('down', Code.Unavailable);
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1], nextPageToken: 'a' })
      .mockRejectedValueOnce(down);

    await expect(
      walkPages(fetchPage, { restartOnce: isInvalidArgument }),
    ).rejects.toBe(down);
  });
});
