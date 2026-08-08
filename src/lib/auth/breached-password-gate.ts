/**
 * The policy layer over the HIBP breach lookup.
 *
 * `src/lib/auth/hibp.ts` deliberately answers only the factual question — is
 * this password in the breach corpus — and documents that "the caller is
 * responsible for deciding policy (allow vs reject) and for emitting audit +
 * metrics". Nothing ever became that caller: `isPasswordBreached` had no
 * non-test caller at all, while the Helm chart advertised
 * `dashboard.auth.hibp.enabled: true` and wired `DASHBOARD_HIBP_ENABLED` into
 * the pod. The control was configured, monitored, and inert.
 *
 * This module is the missing policy half, in one place so every future
 * password-accepting path gets the same answer rather than reinventing it.
 *
 * ## The policy
 *
 * - `breached`  -> REFUSE. A password in the corpus is, by definition, already
 *                  in a credential-stuffing list.
 * - `clean`     -> allow.
 * - `unknown`   -> allow (fail OPEN), and say so loudly in audit + metrics.
 *
 * Failing open on `unknown` is deliberate and worth stating plainly: HIBP is a
 * third party on the far side of the internet, and failing closed would let a
 * two-second outage there stop every signup on the platform. The check is a
 * meaningful reduction in credential-stuffing exposure, not an authentication
 * boundary, so availability wins. `hibp_unavailable` is audited and
 * `dashboard_auth_hibp_checks_total{outcome="unknown"}` is incremented on every
 * such call, which is what the runbook alerts on.
 *
 * `DASHBOARD_HIBP_ENABLED=false` also reports `unknown` (with reason
 * `disabled`) and short-circuits before any network call — that gating lives
 * inside `isPasswordBreached` and is not duplicated here.
 *
 * ## What this is NOT
 *
 * Not a captcha, and not a place to add one. Bot protection on signup is a
 * separate decision, settled separately (WONTFIX), and the two must not get
 * tangled together in one gate.
 */

import "server-only";

import { emitAuthAudit } from "@/src/lib/audit/auth";
import { isPasswordBreached } from "@/src/lib/auth/hibp";
import { hibpChecks } from "@/src/lib/metrics/auth";

/** What the caller must do with the password it was given. */
type BreachedPasswordDecision =
  | { allowed: true }
  | { allowed: false; count: number };

/**
 * Decide whether a password may be used to create or change a credential.
 *
 * Never logs, returns, or transmits the password. On a refusal the breach
 * count is returned so the caller can decide how much to say; the count is a
 * property of the public corpus, not of this user, so surfacing it discloses
 * nothing about them.
 *
 * @param password the candidate password, straight from the form
 * @param context  identifies the call site in audit lines (e.g. `"signup"`)
 * @param userId   audit subject; `"anonymous"` when there is no session yet
 */
export async function assertPasswordNotBreached(
  password: string,
  context: string,
  userId = "anonymous",
): Promise<BreachedPasswordDecision> {
  const result = await isPasswordBreached(password);

  if (result.breached === "unknown") {
    hibpChecks.inc({ outcome: "unknown" });
    // `disabled` is an operator's explicit choice, not a degradation, so it is
    // counted but not audited as an availability event — otherwise every
    // signup on a chart with the flag off would raise a false alarm.
    if (result.reason !== "disabled") {
      emitAuthAudit({
        action: "hibp_unavailable",
        outcome: "failed",
        userId,
        reason: `${context}:${result.reason}`,
      });
    }
    return { allowed: true };
  }

  if (result.breached) {
    hibpChecks.inc({ outcome: "breached" });
    return { allowed: false, count: result.count };
  }

  hibpChecks.inc({ outcome: "clean" });
  return { allowed: true };
}
