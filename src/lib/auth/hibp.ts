/**
 * HIBP (Have I Been Pwned) password breach check.
 *
 * Uses the Pwned Passwords v3 range API with k-anonymity: only the first 5
 * characters of the SHA-1 hash are sent over the network. The full password
 * and full hash never leave this process and are never logged.
 *
 * API docs: https://haveibeenpwned.com/API/v3#PwnedPasswords
 *
 * Configuration:
 *   DASHBOARD_HIBP_ENABLED=false  -> short-circuits to { breached: 'unknown',
 *                                    reason: 'disabled' } with NO network call.
 *
 * Failure mode: fail-open. On timeout / non-200 / network error the function
 * returns `{ breached: 'unknown', reason }`. The caller is responsible for
 * deciding policy (allow vs reject) and for emitting audit + metrics.
 */
import { createHash } from 'node:crypto';

export type HibpResult =
  | { breached: true; count: number }
  | { breached: false; count: 0 }
  | { breached: 'unknown'; reason: string };

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range';
const HIBP_TIMEOUT_MS = 2000;
const USER_AGENT = 'gibson-dashboard';

/**
 * Returns true if HIBP checking is enabled. Disabled only when the env var is
 * literally the string "false" (case-insensitive). Any other value — including
 * unset — is treated as enabled, matching the task's "configurable via env
 * (`DASHBOARD_HIBP_ENABLED=false` short-circuits to unknown)" semantics.
 */
function isEnabled(): boolean {
  const raw = process.env.DASHBOARD_HIBP_ENABLED;
  if (raw === undefined) return true;
  return raw.toLowerCase() !== 'false';
}

/**
 * Check whether a password appears in the HIBP breached-password corpus.
 *
 * Never logs, returns, or transmits the password or its full SHA-1 hash. Only
 * the first 5 hex chars of the SHA-1 hash are sent to the HIBP range endpoint.
 */
export async function isPasswordBreached(password: string): Promise<HibpResult> {
  if (!isEnabled()) {
    return { breached: 'unknown', reason: 'disabled' };
  }

  // SHA-1 the password. The full digest never leaves this function.
  const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
  const prefix5 = digest.slice(0, 5);
  const suffix35 = digest.slice(5);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HIBP_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${HIBP_RANGE_URL}/${prefix5}`, {
      method: 'GET',
      headers: {
        'Add-Padding': 'true',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const reason = classifyFetchError(err);
    return { breached: 'unknown', reason };
  }
  clearTimeout(timeout);

  if (!response.ok) {
    return { breached: 'unknown', reason: `http_${response.status}` };
  }

  let body: string;
  try {
    body = await response.text();
  } catch (err) {
    return { breached: 'unknown', reason: classifyFetchError(err, 'body_read_error') };
  }

  // Each line is "SUFFIX:COUNT\r\n". Some entries are padding with count 0.
  // We split on \n and trim, tolerant of \r, blank lines, and extra whitespace.
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const sepIdx = trimmed.indexOf(':');
    if (sepIdx <= 0) continue;
    const lineSuffix = trimmed.slice(0, sepIdx).toUpperCase();
    if (lineSuffix !== suffix35) continue;
    const countStr = trimmed.slice(sepIdx + 1);
    const count = Number.parseInt(countStr, 10);
    if (Number.isFinite(count) && count > 0) {
      return { breached: true, count };
    }
    // Padding entry (count == 0) means this suffix is not actually breached.
    return { breached: false, count: 0 };
  }

  return { breached: false, count: 0 };
}

function classifyFetchError(err: unknown, fallback = 'fetch_error'): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string };
    if (e.name === 'AbortError') return 'timeout';
    if (typeof e.message === 'string') {
      // Don't surface arbitrary error text; map to a stable reason code.
      if (/abort/i.test(e.message) || /timeout/i.test(e.message)) return 'timeout';
    }
  }
  return fallback;
}
