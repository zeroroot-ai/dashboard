/**
 * Resolves the post-sign-in destination for Auth.js's `redirect()` callback.
 *
 * Auth.js v5's default callback returns `baseUrl` (the site root) when the
 * `__Secure-authjs.callback-url` cookie is missing, empty, or already points
 * at the root. That cookie is set in two places, client-side
 * `signIn("zitadel", { callbackUrl })` and the server-side handoff at
 * src/lib/zitadel/signup-handoff.ts, and either path can race, get stripped
 * by a strict cookie policy, or simply be skipped (user navigates straight to
 * `/login`). The right default for an authenticated user is the product, not
 * the marketing landing page.
 *
 * Rules:
 *   - Relative path starting with `/` (excluding bare `/`) → preserved.
 *   - Same-origin absolute URL → normalised to `${baseUrl}${path}${search}`.
 *   - Bare baseUrl, `/`, empty, cross-origin, protocol-relative, or
 *     unparseable → `${baseUrl}/dashboard`.
 *
 * Pure function, no env or cookie reads, so it can be exhaustively
 * unit-tested. dashboard#228.
 */
export function resolvePostSignInRedirect(
  url: unknown,
  baseUrl: string,
): string {
  const fallback = `${baseUrl}/dashboard`;

  if (typeof url !== "string" || url.length === 0) return fallback;

  // Protocol-relative ("//evil.com/x") is treated by `new URL` as absolute
  // against the current origin in the browser, but here we always reject:
  // Auth.js never legitimately stores protocol-relative URLs in its
  // callback-url cookie, and accepting them would be an open-redirect.
  if (url.startsWith("//")) return fallback;

  if (url.startsWith("/")) {
    if (url === "/") return fallback;
    return `${baseUrl}${url}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return fallback;
  }

  if (parsed.origin !== baseUrl) return fallback;

  const relative = parsed.pathname + parsed.search;
  if (relative === "/" || relative === "") return fallback;
  return `${baseUrl}${relative}`;
}
