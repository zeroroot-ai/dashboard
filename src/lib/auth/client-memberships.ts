/**
 * Client-side membership fetcher for the `useAuthorize` hook.
 *
 * Fetches from `/api/auth/my-memberships`, the thin server-side route that
 * calls `getMyMemberships()` + `readRawActiveTenant()` and returns:
 *
 *   { activeTenantId: string | null, byTenant: { [tenantId]: { role: string } } }
 *
 * where `role` is the proto-emitted FGA relation string (`admin`, `member`).
 *
 * React Query caches the result at `staleTime: 60_000` ms so multiple
 * `useAuthorize` calls on the same page share one fetch.
 *
 * Spec: dashboard-authz-ui-gating Requirement 2.3.
 *
 * @module auth/client-memberships
 */

/**
 * The shape returned by `/api/auth/my-memberships`.
 */
export interface MyMembershipsResponse {
  activeTenantId: string | null;
  byTenant: Record<string, { role: string }>;
}

/**
 * Fetch the current user's memberships from the server-side API route.
 *
 * Intended to be used as the `queryFn` for React Query's `useQuery` inside
 * `useAuthorize`. The function throws on non-2xx responses so React Query
 * can treat the error as a query failure and the hook returns `loading: true`
 * (treated as not-allowed by callers).
 */
export async function fetchMyMemberships(): Promise<MyMembershipsResponse> {
  const res = await fetch('/api/auth/my-memberships', {
    method: 'GET',
    credentials: 'same-origin',
    // Opt out of the Next.js full-route cache so membership changes from
    // tenant-switcher are reflected on the next page render.
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error(`/api/auth/my-memberships returned ${res.status}`);
  }

  return res.json() as Promise<MyMembershipsResponse>;
}
