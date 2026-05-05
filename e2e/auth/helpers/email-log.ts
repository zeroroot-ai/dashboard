/**
 * email-log.ts — helpers for extracting email tokens from the log provider.
 *
 * When `DASHBOARD_EMAIL_PROVIDER=log`, every sent email produces a single
 * JSON line on stdout:
 *
 *   [email.log] {"to":"user@example.com","subject":"..."}
 *
 * In test environments the token itself is NOT in this log line (the log
 * provider intentionally omits bodies for security). Instead, Auth.js /
 * Zitadel emit the full verification / reset URL in their own debug log
 * lines, and the dashboard also emits `[audit.auth]` events that include
 * the token for claim flows.
 *
 * This helper covers two strategies:
 *
 *   1. Kubernetes (kind `gibson` cluster):
 *      Streams `kubectl logs` from the `gibson-dashboard` pod and scans
 *      for token-carrying log lines. The namespace is read from
 *      `DASHBOARD_K8S_NAMESPACE` (default: `gibson`).
 *
 *   2. Local dev server:
 *      Reads from a named log file path `DASHBOARD_LOG_FILE` if set, or
 *      tails stdout written to a temp file by the test harness.
 *
 * For both modes the exported `scrapeToken` function accepts a token type
 * and user email and returns the first matching token found within a
 * configurable timeout.
 *
 * Token URL patterns (Auth.js / Zitadel defaults):
 *   - verify email: `/verify-email/confirm?token=<token>`
 *   - reset password: `/reset-password?token=<token>`
 *   - claim (invitation): the token is the invitation row `id`, delivered
 *     in the claim URL: `/claim-account?token=<token>`
 *
 * Because the log provider only emits `to` + `subject`, we use the audit
 * log lines which DO include the token in a structured JSON field for
 * operations that need it (password-reset, verify, claim). When audit lines
 * are not available we fall back to scanning Auth.js / Zitadel debug output.
 */

import { execSync, spawn } from "child_process";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const K8S_NAMESPACE = process.env.DASHBOARD_K8S_NAMESPACE ?? "gibson";
const K8S_POD_LABEL =
  process.env.DASHBOARD_K8S_POD_LABEL ?? "app.kubernetes.io/name=gibson-dashboard";
const LOG_FILE = process.env.DASHBOARD_LOG_FILE ?? "";

/** How long to wait for a token to appear in logs (ms). */
const SCRAPE_TIMEOUT_MS =
  parseInt(process.env.DASHBOARD_EMAIL_SCRAPE_TIMEOUT_MS ?? "30000", 10);

/** How long to sleep between log-poll iterations (ms). */
const POLL_INTERVAL_MS = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TokenType = "verify" | "reset" | "claim";

interface ScrapeOptions {
  /** Recipient email to match against (log lines contain `"to":"<email>"`) */
  to: string;
  /** Which token type to extract */
  tokenType: TokenType;
  /** Optional override timeout in ms */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Log source abstraction
// ---------------------------------------------------------------------------

/**
 * Fetches recent log output as a string. In CI against a kind cluster this
 * runs `kubectl logs`; locally it reads the file at `DASHBOARD_LOG_FILE`.
 *
 * Returns an empty string if neither source is available (tests skip/warn).
 */
function fetchLogs(sinceSeconds = 120): string {
  if (LOG_FILE) {
    try {
      return execSync(`tail -n 2000 ${LOG_FILE}`, {
        timeout: 5000,
        encoding: "utf-8",
      });
    } catch {
      return "";
    }
  }

  // Kubernetes path: try to get logs from the dashboard pod.
  try {
    return execSync(
      `kubectl logs -n ${K8S_NAMESPACE} -l "${K8S_POD_LABEL}" --tail=500 --since=${sinceSeconds}s 2>/dev/null || true`,
      { timeout: 10_000, encoding: "utf-8" },
    );
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Token extraction patterns
// ---------------------------------------------------------------------------

/**
 * Given a block of log text and a token type + recipient, tries to extract
 * the token string.
 *
 * The dashboard emits Auth.js / Zitadel debug lines that include the full URL, e.g.:
 *   Sending verification email to user@example.com: .../verify-email/confirm?token=abc123
 *
 * Audit lines look like:
 *   [audit.auth] {"action":"email_verification_requested","token":"abc123",...}
 *   [audit.auth] {"action":"password_reset_requested","token":"abc123",...}
 *   [audit.auth] {"action":"claim_completed","claimToken":"abc123",...}
 *
 * We scan for both patterns. The first match wins.
 */
function extractToken(
  logs: string,
  tokenType: TokenType,
  recipientEmail: string,
): string | null {
  const lines = logs.split("\n");

  // URL patterns for each type.
  const urlSegments: Record<TokenType, string> = {
    verify: "/verify-email/confirm?token=",
    reset: "/reset-password?token=",
    claim: "/claim-account?token=",
  };

  // Audit field names for each type.
  const auditFields: Record<TokenType, string[]> = {
    verify: ["token"],
    reset: ["token", "resetToken"],
    claim: ["token", "claimToken"],
  };

  // Escape the email for regex use.
  const escapedEmail = recipientEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  for (const line of lines) {
    // --- Strategy 1: URL in the line ---
    const urlSegment = urlSegments[tokenType];
    if (line.includes(urlSegment)) {
      // Optionally check the email appears nearby.
      const emailPresent =
        !recipientEmail || line.includes(recipientEmail);

      const idx = line.indexOf(urlSegment);
      if (idx !== -1) {
        const rest = line.slice(idx + urlSegment.length);
        // Token ends at whitespace or quote.
        const match = rest.match(/^([A-Za-z0-9_\-%.]+)/);
        if (match && match[1] && (emailPresent || !recipientEmail)) {
          return match[1];
        }
      }
    }

    // --- Strategy 2: Audit JSON line ---
    if (line.includes("[audit.auth]")) {
      // Check the recipient if we can.
      if (recipientEmail && !line.includes(recipientEmail)) {
        // Might be a different user's event; try next line.
        continue;
      }
      try {
        const jsonStart = line.indexOf("{");
        if (jsonStart === -1) continue;
        const obj = JSON.parse(line.slice(jsonStart)) as Record<string, unknown>;
        for (const field of auditFields[tokenType]) {
          const val = obj[field];
          if (typeof val === "string" && val.length > 0) {
            return val;
          }
        }
      } catch {
        // Not valid JSON — skip.
      }
    }

    // --- Strategy 3: Email log line with debug body ---
    // Some dev-server configurations emit full URLs in the [email.log] line
    // as a debug extension. Try to extract from there too.
    if (line.includes("[email.log]") && line.includes(recipientEmail)) {
      const urlSeg = urlSegments[tokenType];
      const idx = line.indexOf(urlSeg);
      if (idx !== -1) {
        const rest = line.slice(idx + urlSeg.length);
        const match = rest.match(/^([A-Za-z0-9_\-%.]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }
    }
  }

  // --- Strategy 4: Looser URL match anywhere in a line (no email check) ---
  // Used as last resort when the email doesn't appear in the same line.
  for (const line of lines) {
    const urlSegment = urlSegments[tokenType];
    const idx = line.indexOf(urlSegment);
    if (idx !== -1) {
      const rest = line.slice(idx + urlSegment.length);
      const match = rest.match(/^([A-Za-z0-9_\-%.]+)/);
      if (match && match[1]) {
        return match[1];
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Polls the dashboard log source (k8s logs or local log file) until a token
 * matching `tokenType` and `to` is found, or `timeoutMs` elapses.
 *
 * Returns the raw token string (not a full URL).
 *
 * Throws if no token is found within the timeout — the calling test will fail
 * with a meaningful error.
 *
 * @example
 * const token = await scrapeToken({ to: 'user@e2e.test', tokenType: 'verify' });
 * await page.goto(`${BASE_URL}/verify-email/confirm?token=${token}`);
 */
export async function scrapeToken(opts: ScrapeOptions): Promise<string> {
  const { to, tokenType, timeoutMs = SCRAPE_TIMEOUT_MS } = opts;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const logs = fetchLogs(180); // last 3 minutes
    const token = extractToken(logs, tokenType, to);
    if (token) {
      return token;
    }
    // Wait before next poll.
    await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
  }

  throw new Error(
    `[email-log] Timed out after ${timeoutMs}ms waiting for ${tokenType} token for <${to}>. ` +
      `Check that DASHBOARD_EMAIL_PROVIDER=log is set and the dashboard pod is reachable.`,
  );
}

/**
 * Returns whether the log infrastructure is reachable at all.
 * Tests can call this in a `test.skip` guard to avoid hanging on
 * clusters that don't have kubectl access.
 */
export function isLogSourceReachable(): boolean {
  if (LOG_FILE) {
    try {
      execSync(`test -f ${LOG_FILE}`, { timeout: 1000 });
      return true;
    } catch {
      return false;
    }
  }
  try {
    execSync(
      `kubectl get pods -n ${K8S_NAMESPACE} -l "${K8S_POD_LABEL}" --no-headers 2>/dev/null | head -1`,
      { timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}
