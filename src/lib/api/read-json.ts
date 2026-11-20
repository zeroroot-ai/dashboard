// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * Read JSON from a route of the dashboard. A response that is not ok throws an
 * Error with the message of the route, or the HTTP status when it has none.
 */
export async function readJson<T>(url: string, failure: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(body.error?.message ?? `${failure} (HTTP ${res.status})`);
  }
  return (await res.json()) as T;
}
