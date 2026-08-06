/**
 * Shared fetch wrapper that attaches the CSRF token header on mutating requests.
 *
 * The double-submit `csrf-token` cookie (src/lib/csrf.ts) is validated against
 * the `x-csrf-token` header on POST/PUT/PATCH/DELETE. This wrapper reads the
 * cookie and echoes it back automatically so individual API clients don't need
 * to worry about it.
 *
 * The cookie is seeded by middleware (`ensureCsrfCookie` in src/lib/csrf.ts) on
 * every pass-through navigation; its previous seeder (proxy.ts) was removed in
 * the E9 sweep and re-homed to middleware (dashboard#862).
 */

// Two names, one cookie. A TLS origin gets the `__Host-` prefixed form (the
// browser then refuses any Set-Cookie for it that carries a Domain attribute,
// so a sibling host cannot overwrite it); a plain-http origin cannot store a
// Secure cookie at all and gets the unprefixed form. See src/lib/csrf.ts.
// Ordered most-preferred first.
const CSRF_COOKIE_NAMES = ['__Host-csrf-token', 'csrf-token'] as const;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  for (const name of CSRF_COOKIE_NAMES) {
    // `__Host-` contains no regex metacharacters, so interpolation is safe here.
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
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
