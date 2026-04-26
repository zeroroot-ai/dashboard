/**
 * Redirect URL allowlist helper.
 *
 * The dashboard only ever redirects to its own origin after auth flows.
 * Any external `redirectTo` parameter (passed by the client, included in
 * social sign-in state, etc.) is validated here before being honoured.
 *
 * Rules:
 *  - Same-origin absolute URL → return the path+search+hash (strip origin).
 *  - Relative path starting with "/" → return as-is.
 *  - Protocol-relative "//..." → reject (open-redirect vector), return "/".
 *  - Cross-origin absolute URL → reject, return "/".
 *  - `javascript:` or other non-http(s) schemes → reject, return "/".
 *  - Empty / missing → return "/".
 *
 * The allowed origin is derived from BETTER_AUTH_URL. If BETTER_AUTH_URL is
 * unset (e.g. in test environments), only relative paths are accepted.
 */

/**
 * Validate a redirectTo URL and return a safe version.
 *
 * @param url - Raw URL string from an untrusted source (query param, etc.)
 * @returns A path that is safe to redirect to within the dashboard, or "/".
 */
export function validateRedirectTo(url: string | null | undefined): string {
  if (!url || url.trim().length === 0) return "/";

  const raw = url.trim();

  // Reject protocol-relative URLs ("//evil.com/...") — they are interpreted
  // as absolute by browsers and would allow open-redirect.
  if (raw.startsWith("//")) return "/";

  // Accept simple root-relative paths ("/foo/bar", "/?x=1", "/#hash").
  // These cannot point outside the current origin.
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    // Extra safety: reject paths that could encode the forbidden "//" prefix
    // after normalisation (e.g. "/\\" in some browsers).
    if (/^\/[\\\/]/.test(raw)) return "/";
    return raw;
  }

  // For absolute URLs, only accept same-origin redirects.
  const allowedOrigin = resolveAllowedOrigin();
  if (!allowedOrigin) {
    // No origin configured — absolute URLs are not allowed.
    return "/";
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // Unparseable — reject.
    return "/";
  }

  // Reject non-http(s) schemes (javascript:, data:, etc.).
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "/";
  }

  // Compare origins (scheme + host + port).
  if (parsed.origin !== allowedOrigin) {
    return "/";
  }

  // Same origin — return only the path + search + hash (no origin prefix).
  return parsed.pathname + parsed.search + parsed.hash;
}

/**
 * Resolve the dashboard's own origin from NEXTAUTH_URL / AUTH_URL.
 * Returns null if the env var is unset or the URL is unparseable.
 *
 * Spec: unified-identity-and-authorization Phase 4 — BetterAuth env
 * vars (BETTER_AUTH_URL/BETTER_AUTH_SECRET) are gone; Auth.js uses
 * the standard NEXTAUTH_URL convention.
 */
function resolveAllowedOrigin(): string | null {
  const raw = process.env.NEXTAUTH_URL || process.env.AUTH_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}
