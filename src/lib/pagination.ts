// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Shared guard for "fetch every page" loops (dashboard#107 follow-up).
 *
 * hosted's demo exit test signed a fresh Owner into a fresh tenant, the pod
 * ran for ~11 minutes on nothing but health probes, then died with
 * "JavaScript heap out of memory" 60-90 seconds after the FIRST authenticated
 * `/dashboard` server render, right when Envoy briefly returned an upstream
 * connect error. That timing means a RUNAWAY ALLOCATION triggered by that one
 * render, not a slow per-request leak: something loops accumulating results
 * forever while a backend RPC keeps returning a token.
 *
 * This repo had exactly two hand-rolled "fetch every page" loops
 * (`app/actions/crd/teams.ts`, `app/api/missions/[id]/jobs/route.ts`), both
 * shaped as `do { ... } while (pageToken)`. Neither one ever stopped if the
 * daemon returned the SAME token again (a stuck cursor), an EMPTY page with a
 * non-empty token (nothing left to read but the daemon still says "more"),
 * or, in the pathological case, an endless stream of distinct tokens. Every
 * one of those turns a bounded RPC into an unbounded accumulation of results
 * in memory, with no cap and no error logged, exactly the shape of bug that
 * produces "process ran fine for a while, then died on the first render that
 * exercised it."
 *
 * `collectAllPages` is the ONE place that walks a token-paginated RPC to
 * completion. It stops on any of three conditions, in order:
 *
 *   1. the daemon returns the SAME token it was just given (a stuck cursor);
 *   2. a page comes back with zero items but a non-empty next token (nothing
 *      left to read, but the daemon still claims there is more);
 *   3. a hard page cap is reached, logged as an error rather than silently
 *      truncated, so an actually-misbehaving backend shows up in alerts
 *      instead of a dashboard OOM.
 *
 * Every future "list everything across pages" loop in this repo MUST go
 * through this helper rather than hand-rolling its own `do`/`while`.
 */

import { logger } from './logger';

/** Minimal shape every paginated RPC response needs to satisfy. */
export interface PageLike<T> {
  items: readonly T[];
  nextPageToken: string;
}

export type PaginationStopReason =
  | 'repeated_token'
  | 'empty_page_with_token'
  | 'max_pages_exceeded';

export interface CollectAllPagesOptions {
  /**
   * Hard cap on the number of pages fetched. This is a backstop, not the
   * expected steady-state page count, legitimate lists in this product are
   * nowhere near this size. Default 500.
   */
  maxPages?: number;
  /**
   * Identifies the call site in the logged error/warning, e.g.
   * "MembershipService.ListTeams". Required so a tripped guard is
   * actionable, not just a generic message.
   */
  rpc: string;
  /** Extra structured fields to attach to the log line (tenantId, etc.). */
  context?: Record<string, unknown>;
}

/**
 * Fetch every page of a token-paginated RPC and return the concatenated
 * items, stopping the moment continuing would be unbounded. See the module
 * doc comment for the three stop conditions.
 */
export async function collectAllPages<T>(
  fetchPage: (pageToken: string) => Promise<PageLike<T>>,
  options: CollectAllPagesOptions,
): Promise<T[]> {
  const maxPages = options.maxPages ?? 500;
  const items: T[] = [];
  let pageToken = '';
  let pages = 0;

  for (;;) {
    pages += 1;
    if (pages > maxPages) {
      logger.error(
        { scope: 'pagination.guard', reason: 'max_pages_exceeded' satisfies PaginationStopReason, rpc: options.rpc, pages: pages - 1, ...options.context },
        `${options.rpc}: stopped after ${pages - 1} pages (hard cap), the caller is not seeing the full result set`,
      );
      break;
    }

    const page = await fetchPage(pageToken);
    items.push(...page.items);
    const next = page.nextPageToken;

    if (!next) {
      // Normal termination: the RPC contract for "no more pages" is an
      // empty next-page token.
      break;
    }
    if (next === pageToken) {
      logger.warn(
        { scope: 'pagination.guard', reason: 'repeated_token' satisfies PaginationStopReason, rpc: options.rpc, pages, ...options.context },
        `${options.rpc}: returned the same page token twice, stopping instead of looping forever`,
      );
      break;
    }
    if (page.items.length === 0) {
      logger.warn(
        { scope: 'pagination.guard', reason: 'empty_page_with_token' satisfies PaginationStopReason, rpc: options.rpc, pages, ...options.context },
        `${options.rpc}: returned an empty page with a non-empty next-page token, stopping instead of looping forever`,
      );
      break;
    }
    pageToken = next;
  }

  return items;
}
