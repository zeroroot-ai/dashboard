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

/** Resolve the requester's IP from the edge-supplied headers. */
export async function resolveClientIp(): Promise<string> {
  const hdrs = await headers();
  return clientIpFromHeaders({
    forwardedFor: hdrs.get('x-forwarded-for'),
    realIp: hdrs.get('x-real-ip'),
  });
}

/** Pure form, so the header handling is testable without a request. */
export function clientIpFromHeaders(h: {
  forwardedFor?: string | null;
  realIp?: string | null;
}): string {
  const first = h.forwardedFor?.split(',')[0]?.trim();
  if (first) return first;
  const real = h.realIp?.trim();
  if (real) return real;
  return '';
}
