// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Unit tests for the shared "fetch every page" guard (dashboard#107
 * follow-up). Every test drives `collectAllPages` against a fake daemon
 * client, not the real transport, exactly the proof the incident asked for:
 * a fake backend that repeats a token must not make the loop run forever.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('./logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { collectAllPages } from './pagination';
import { logger } from './logger';

describe('collectAllPages', () => {
  it('walks pages until the daemon returns an empty next-page token', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [1, 2], nextPageToken: 'p2' })
      .mockResolvedValueOnce({ items: [3], nextPageToken: 'p3' })
      .mockResolvedValueOnce({ items: [4], nextPageToken: '' });

    const items = await collectAllPages(fetchPage, { rpc: 'Test.List' });

    expect(items).toEqual([1, 2, 3, 4]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, '');
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'p2');
    expect(fetchPage).toHaveBeenNthCalledWith(3, 'p3');
  });

  it('a single page with no next token makes exactly one call', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: ['only'], nextPageToken: '' });

    const items = await collectAllPages(fetchPage, { rpc: 'Test.List' });

    expect(items).toEqual(['only']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('stops when the fake daemon repeats the same page token forever (the incident shape)', async () => {
    // A stuck cursor: every call after the first returns the SAME token it
    // was just given, with a fresh copy of the same item. Without a guard
    // this loop, and the accumulated `items` array, never stop growing.
    const fetchPage = vi.fn(async (pageToken: string) => {
      if (pageToken === '') {
        return { items: ['a'], nextPageToken: 'stuck' };
      }
      return { items: ['a'], nextPageToken: 'stuck' };
    });

    const items = await collectAllPages(fetchPage, { rpc: 'Test.List' });

    // The page that reveals the repeat is only detectable AFTER it has been
    // fetched and its items collected, so one extra page's worth of data is
    // tolerated. What matters is that the loop stops there: bounded, not
    // the unbounded growth the incident produced.
    expect(items).toEqual(['a', 'a']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'repeated_token', rpc: 'Test.List' }),
      expect.stringContaining('returned the same page token twice'),
    );
  });

  it('stops when a page comes back empty but the next-page token is still non-empty', async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: ['a'], nextPageToken: 'p2' })
      .mockResolvedValue({ items: [], nextPageToken: 'p3' });

    const items = await collectAllPages(fetchPage, { rpc: 'Test.List' });

    expect(items).toEqual(['a']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'empty_page_with_token', rpc: 'Test.List' }),
      expect.stringContaining('empty page with a non-empty next-page token'),
    );
  });

  it('stops at the hard page cap and logs an error when the daemon keeps minting new, distinct tokens', async () => {
    // The pathological case a repeated-token check alone cannot catch: every
    // page is non-empty and every token is different from the last one, so
    // nothing here looks locally wrong, it just never ends.
    let n = 0;
    const fetchPage = vi.fn(async () => {
      n += 1;
      return { items: [n], nextPageToken: `p${n + 1}` };
    });

    const items = await collectAllPages(fetchPage, { rpc: 'Test.List', maxPages: 5 });

    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(5);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'max_pages_exceeded', rpc: 'Test.List', pages: 5 }),
      expect.stringContaining('stopped after 5 pages'),
    );
  });

  it('passes context fields through to the logged guard event', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ items: [], nextPageToken: 'stuck' });

    await collectAllPages(fetchPage, {
      rpc: 'Test.List',
      context: { tenantId: 't1' },
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
      expect.any(String),
    );
  });
});
