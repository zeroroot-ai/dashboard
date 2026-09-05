/**
 * Server-side CAPTCHA verifier.
 *
 * Verifies a CAPTCHA token produced by the client widget against the
 * configured provider's siteverify endpoint. Never exposes the provider
 * secret key to the client, it is read from `DASHBOARD_CAPTCHA_SECRET_KEY`
 * at call time on the server.
 *
 * Provider switch via `DASHBOARD_CAPTCHA_PROVIDER`:
 *   - `turnstile` : Cloudflare Turnstile
 *   - `hcaptcha`  : hCaptcha
 *   - `disabled`  : short-circuit to { ok: true }, emit a one-shot startup
 *                   warning on first call
 *   - unset/other : treated as `disabled`
 *
 * Failure semantics: any network error, non-200 response, or malformed
 * provider payload yields `{ ok: false, reason }`. Caller is responsible
 * for audit logging and returning a user-safe error code.
 *
 * Timeouts: 3 seconds per provider call; requests are aborted via
 * AbortController so we never hang a Server Action on a slow provider.
 */

const TURNSTILE_VERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';
const VERIFY_TIMEOUT_MS = 3000;

type CaptchaProvider = 'turnstile' | 'hcaptcha' | 'disabled';

type CaptchaResult =
  | { ok: true; score?: number }
  | { ok: false; reason: string };

/**
 * Cloudflare Turnstile siteverify response.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
interface TurnstileResponse {
  success: boolean;
  'error-codes'?: string[];
  challenge_ts?: string;
  hostname?: string;
  action?: string;
  cdata?: string;
  // Turnstile does not currently return a score, but the interface leaves
  // room for one; we pass it through if the provider ever adds it.
  score?: number;
}

/**
 * hCaptcha siteverify response.
 * https://docs.hcaptcha.com/#verify-the-user-response-server-side
 */
interface HCaptchaResponse {
  success: boolean;
  challenge_ts?: string;
  hostname?: string;
  credit?: boolean;
  'error-codes'?: string[];
  score?: number;
  score_reason?: string[];
}

// Module-level flag so the startup warning fires at most once per process,
// even if verifyCaptcha is called repeatedly with the provider disabled.
let disabledWarningEmitted = false;

/**
 * Test-only hook to reset the one-shot warning flag. Not part of the
 * public API contract.
 */
export function __resetDisabledWarningForTests(): void {
  disabledWarningEmitted = false;
}

function resolveProvider(): CaptchaProvider {
  // DASHBOARD_CAPTCHA_PROVIDER is REQUIRED at boot (src/lib/env-validator.ts) -
  // an explicit choice (including "disabled") is required, no implicit absence.
  const raw = process.env.DASHBOARD_CAPTCHA_PROVIDER;
  if (!raw) {
    throw new Error(
      '[captcha] DASHBOARD_CAPTCHA_PROVIDER is required. ' +
        'Set to "turnstile" | "hcaptcha" | "disabled". See src/lib/env-validator.ts.',
    );
  }
  const choice = raw.toLowerCase();
  if (choice === 'turnstile') return 'turnstile';
  if (choice === 'hcaptcha') return 'hcaptcha';
  return 'disabled';
}

function emitDisabledWarningOnce(): void {
  if (disabledWarningEmitted) return;
  disabledWarningEmitted = true;
  // eslint-disable-next-line no-console
  console.warn(
    '[captcha] WARNING: CAPTCHA disabled; set DASHBOARD_CAPTCHA_PROVIDER to enable',
  );
}

function classifyFetchError(err: unknown, fallback = 'fetch_error'): string {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string };
    if (e.name === 'AbortError') return 'timeout';
    if (typeof e.message === 'string' && /timeout|abort/i.test(e.message)) {
      return 'timeout';
    }
  }
  return fallback;
}

async function postForm(
  url: string,
  body: URLSearchParams,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function verifyTurnstile(
  token: string,
  remoteIp?: string,
): Promise<CaptchaResult> {
  const secret = process.env.DASHBOARD_CAPTCHA_SECRET_KEY;
  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }

  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token);
  if (remoteIp) params.set('remoteip', remoteIp);

  let response: Response;
  try {
    response = await postForm(TURNSTILE_VERIFY_URL, params);
  } catch (err) {
    return { ok: false, reason: classifyFetchError(err) };
  }

  if (!response.ok) {
    return { ok: false, reason: `http_${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return { ok: false, reason: classifyFetchError(err, 'bad_json') };
  }

  if (!body || typeof body !== 'object') {
    return { ok: false, reason: 'bad_response' };
  }

  const parsed = body as TurnstileResponse;
  if (parsed.success === true) {
    const result: CaptchaResult = { ok: true };
    if (typeof parsed.score === 'number') {
      (result as { ok: true; score?: number }).score = parsed.score;
    }
    return result;
  }

  const codes = Array.isArray(parsed['error-codes'])
    ? parsed['error-codes']
    : [];
  const reason = codes.length > 0 ? codes.join(',') : 'verification_failed';
  return { ok: false, reason };
}

async function verifyHCaptcha(
  token: string,
  remoteIp?: string,
): Promise<CaptchaResult> {
  const secret = process.env.DASHBOARD_CAPTCHA_SECRET_KEY;
  if (!secret) {
    return { ok: false, reason: 'missing_secret' };
  }

  const params = new URLSearchParams();
  params.set('secret', secret);
  params.set('response', token);
  if (remoteIp) params.set('remoteip', remoteIp);

  let response: Response;
  try {
    response = await postForm(HCAPTCHA_VERIFY_URL, params);
  } catch (err) {
    return { ok: false, reason: classifyFetchError(err) };
  }

  if (!response.ok) {
    return { ok: false, reason: `http_${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return { ok: false, reason: classifyFetchError(err, 'bad_json') };
  }

  if (!body || typeof body !== 'object') {
    return { ok: false, reason: 'bad_response' };
  }

  const parsed = body as HCaptchaResponse;
  if (parsed.success === true) {
    const result: CaptchaResult = { ok: true };
    if (typeof parsed.score === 'number') {
      (result as { ok: true; score?: number }).score = parsed.score;
    }
    return result;
  }

  const codes = Array.isArray(parsed['error-codes'])
    ? parsed['error-codes']
    : [];
  const reason = codes.length > 0 ? codes.join(',') : 'verification_failed';
  return { ok: false, reason };
}

/**
 * Verify a CAPTCHA token server-side. `token` is the value produced by
 * the client widget (Turnstile `cf-turnstile-response`, hCaptcha
 * `h-captcha-response`). `remoteIp` is the end-user's IP, forwarded to
 * the provider when available.
 *
 * Never throws. Always resolves to a discriminated union so callers can
 * switch on `result.ok` without `try/catch`.
 */
export async function verifyCaptcha(
  token: string,
  remoteIp?: string,
): Promise<CaptchaResult> {
  const provider = resolveProvider();

  if (provider === 'disabled') {
    emitDisabledWarningOnce();
    return { ok: true };
  }

  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'missing_token' };
  }

  if (provider === 'turnstile') {
    return verifyTurnstile(token, remoteIp);
  }
  // provider === 'hcaptcha'
  return verifyHCaptcha(token, remoteIp);
}
