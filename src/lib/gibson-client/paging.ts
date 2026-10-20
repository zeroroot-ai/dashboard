// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * The one walker for the daemon list RPCs that page with page_size,
 * page_token and next_page_token (ADR-0028). A caller that reads only the
 * first response gets one page of 100 rows, so every caller of a paged list
 * goes through walkPages instead.
 *
 * The walk is bounded. It stops when the daemon returns an empty
 * next_page_token, when `limit` rows are in hand, or after `maxPages` pages.
 * A walk that stops with a token left reports `truncated: true`.
 *
 */

import { Code, ConnectError } from '@connectrpc/connect';
import { logger } from '@/src/lib/logger';

/** True for a daemon InvalidArgument, the answer to a page token it refuses. */
export function isInvalidArgument(err: unknown): boolean {
  return ConnectError.from(err).code === Code.InvalidArgument;
}

/** Largest page the daemon accepts (page_size is validated to 0..1000). */
export const MAX_PAGE_SIZE = 1000;

/** Default bound on pages read for one walk. */
export const DEFAULT_MAX_PAGES = 10;

/** One page, as the walker needs it. */
export interface Page<T> {
  items: T[];
  /** Empty on the last page. */
  nextPageToken: string;
}

interface WalkOptions {
  /** Maximum rows to return in total. Omit it to read up to the page bound. */
  limit?: number;
  /** Bound on pages read. Defaults to DEFAULT_MAX_PAGES. */
  maxPages?: number;
  /**
   * Called with the error of a page request that carried a page token. When
   * it returns true the walk restarts once from the first page, and the rows
   * read so far are dropped. GetTimeline uses it because its tokens are
   * bound to one mission run.
   */
  restartOnce?: (err: unknown) => boolean;
}

interface WalkResult<T> {
  items: T[];
  /** True when the walk stopped while the daemon had more rows. */
  truncated: boolean;
}

/**
 * Reads pages until the list ends or a bound is reached.
 *
 * `fetchPage` gets the page size to ask for (never above MAX_PAGE_SIZE) and
 * the token of the previous page ('' for the first page).
 */
export async function walkPages<T>(
  fetchPage: (pageSize: number, pageToken: string) => Promise<Page<T>>,
  options: WalkOptions = {},
): Promise<WalkResult<T>> {
  const want = options.limit && options.limit > 0 ? options.limit : 0;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  let items: T[] = [];
  let pageToken = '';
  let restarted = false;
  let pages = 0;

  while (pages < maxPages) {
    const remaining = want > 0 ? want - items.length : MAX_PAGE_SIZE;
    const pageSize = Math.min(remaining, MAX_PAGE_SIZE);
    let page: Page<T>;
    try {
      page = await fetchPage(pageSize, pageToken);
    } catch (err) {
      if (pageToken !== '' && !restarted && options.restartOnce?.(err)) {
        restarted = true;
        items = [];
        pageToken = '';
        pages = 0;
        continue;
      }
      throw err;
    }
    pages++;
    items.push(...page.items);
    pageToken = page.nextPageToken ?? '';
    if (pageToken === '' || (want > 0 && items.length >= want)) break;
  }

  const sliced = want > 0 && items.length > want;
  if (sliced) items = items.slice(0, want);
  return { items, truncated: pageToken !== '' || sliced };
}

/**
 * walkPages for a caller that needs only the rows. A walk that stops at a
 * bound with rows left is logged under `label`, so a cut list is never silent.
 */
export async function walkItems<T>(
  label: string,
  fetchPage: (pageSize: number, pageToken: string) => Promise<Page<T>>,
  options: WalkOptions = {},
): Promise<T[]> {
  const { items, truncated } = await walkPages(fetchPage, options);
  if (truncated) {
    logger.warn({ list: label, rows: items.length }, 'list cut at the page bound');
  }
  return items;
}
