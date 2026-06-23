/**
 * Shared fetch wrapper that attaches the CSRF token header on mutating requests.
 *
 * The double-submit `csrf-token` cookie (src/lib/csrf.ts) is validated against
 * the `x-csrf-token` header on POST/PUT/PATCH/DELETE. This wrapper reads the
 * cookie and echoes it back automatically so individual API clients don't need
 * to worry about it.
 *
 * NOTE (dashboard#862): the cookie's only seeder (proxy.ts) was removed in the
 * E9 sweep, so the cookie is currently never set and `requireCsrf` fails closed
 * on the mission routes. Tracked for a re-seed-or-retire decision in #862.
 */

const CSRF_COOKIE = 'csrf-token';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Drop-in replacement for `fetch` that adds the `x-csrf-token` header
 * on mutating requests. All other behaviour is identical to the native fetch.
 */
export function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase();

  if (MUTATING_METHODS.has(method)) {
    const token = getCsrfToken();
    if (token) {
      const headers = new Headers(init?.headers);
      if (!headers.has('x-csrf-token')) {
        headers.set('x-csrf-token', token);
      }
      return fetch(input, { ...init, headers });
    }
  }

  return fetch(input, init);
}
