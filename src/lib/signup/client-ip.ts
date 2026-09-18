// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Client-IP resolution for the signup abuse budgets.
 *
 * The daemon keys its per-source signup budgets on this value. It is a hint,
 * not an authenticated fact: the edge writes the header, and everything between
 * the edge and here is trusted only because the daemon accepts the field solely
 * from the dashboard workload over SPIFFE mTLS. If that ever stops being true
 * the per-source budgets stop meaning anything — which is why the daemon also
 * carries budgets that do not depend on it (per address, and one global).
 *
 * An unresolvable IP is reported as the empty string rather than a placeholder
 * like "unknown". The daemon routes empty to a small shared unattributed
 * bucket; a placeholder string would instead look like one very busy source and
 * draw on the normal per-IP allowance.
 */

import 'server-only';
import { headers } from 'next/headers';
import {
  resolveClientIp as resolveTrustedClientIp,
  UNIDENTIFIED_SOURCE,
} from '@/src/lib/rate-limiter';

/**
 * Resolve the requester's IP from the edge-supplied headers.
 *
 * One implementation, in src/lib/rate-limiter.ts: the entry `hops` from the
 * right of `X-Forwarded-For`, which the outermost proxy we operate wrote.
 * Envoy appends to the header, so the leftmost entry is the caller's own
 * text. Reading it keyed every per-source signup budget on a value the
 * attacker chose (a fresh address per attempt, or a victim's address to
 * spend the victim's budget).
 */
export async function resolveClientIp(): Promise<string> {
  return clientIpForDaemon(await headers());
}

/**
 * Pure form, so the header handling is testable without a request. The
 * daemon routes the empty string to a small shared unattributed bucket, so
 * an unresolvable source is reported as '' and never as a placeholder.
 */
export function clientIpForDaemon(hdrs: Pick<Headers, 'get'>): string {
  const ip = resolveTrustedClientIp(hdrs);
  return ip === UNIDENTIFIED_SOURCE ? '' : ip;
}
