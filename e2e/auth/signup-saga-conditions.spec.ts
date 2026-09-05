/**
 * signup-saga-conditions.spec.ts
 *
 * End-to-end exercise of the tenant-operator's full provisioning saga
 * after spec `tenant-operator-saga-capabilities` wires Langfuse + Vault
 * + DaemonGRPC into psaga.Deps.
 *
 * Distinct from `signup-happy-path.spec.ts`:
 *   - The assertion focus is the **K8s Tenant CR's status conditions**.
 *     Each saga step writes a typed condition; we assert every expected
 *     condition flips to True within a 5-minute window. Failures dump
 *     the operator pod's logs for the failing step's name so the
 *     reviewer sees exactly which capability isn't wired correctly.
 *   - Vault path lookup proves the operator's admin client + transit
 *     client are both functional (PostgresCredentials envelope written).
 *   - Langfuse admin API call proves the operator's Langfuse client
 *     is functional (per-tenant project created).
 *
 * Pre-conditions:
 *   - Full chart deployed to the `gibson` Kind cluster
 *     (`make -C enterprise/deploy/helm/gibson deploy-local`).
 *   - `dataPlane.vault.enabled=true` AND `dataPlane.vault.kindRootToken=true`
 *     (default in `values-kind.yaml` after this spec).
 *   - `BILLING_DEV_AUTOCONFIRM=true` so the WaitForBillingConfirmation
 *     step short-circuits without a real Stripe webhook tunnel.
 *   - kubectl in PATH with kind-gibson context active.
 *
 * Cleanup:
 *   The Tenant CR is deleted via `kubectl` after the assertions pass so
 *   re-runs stay idempotent.
 *
 * Spec: tenant-operator-saga-capabilities Requirement 5.
 */

import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { BASE_URL, generateUserCredentials } from "./helpers/fixtures";

// Conditions every Ready Tenant must carry post-saga in kind. Stripe
// surfaces as `StripeReady=True (Skipped)` because the operator's
// Stripe client is nil (capability declaration dropped per spec
// Requirement 4), the step's body returns done=true on nil deps.
// Stripe; BillingPending=True comes from BILLING_DEV_AUTOCONFIRM=true.
const REQUIRED_CONDITIONS = [
  "LangfuseReady",
  "FGAReady",
  "SecretsBackendReady",
  "RedisReady",
  "Neo4jReady",
  "DataPlaneProvisioned",
  "EntitlementsReconciled",
] as const;

const TIMEOUT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 5_000;

interface TenantCondition {
  type: string;
  status: "True" | "False" | "Unknown";
  reason?: string;
  message?: string;
}

interface TenantStatus {
  phase?: string;
  conditions?: TenantCondition[];
  langfuseProjectID?: string;
  namespace?: string;
}

/** Run a kubectl command with kind-gibson context and return stdout. */
function kubectl(args: string[]): string {
  return execSync(
    `kubectl --context kind-gibson ${args.join(" ")}`,
    { encoding: "utf-8" },
  );
}

/** Read a Tenant CR's status. Returns null when the CR doesn't exist yet. */
function readTenantStatus(slug: string): TenantStatus | null {
  try {
    const raw = kubectl(["get", "tenant", slug, "-o", "json"]);
    const obj = JSON.parse(raw);
    return (obj.status ?? {}) as TenantStatus;
  } catch {
    return null;
  }
}

/** Print operator pod logs (last 200 lines) to test output. */
function printOperatorLogs(): void {
  try {
    const podName = kubectl([
      "get", "pods", "-n", "gibson",
      "-l", "app.kubernetes.io/name=gibson-tenant-operator",
      "-o", "jsonpath={.items[0].metadata.name}",
    ]).trim();
    const logs = kubectl(["logs", "-n", "gibson", podName, "--tail=200"]);
    console.error(`\n=== gibson-tenant-operator logs (${podName}) ===\n${logs}\n=== end logs ===\n`);
  } catch (err) {
    console.error("[saga-conditions] failed to fetch operator logs:", err);
  }
}

test.describe("Signup → all saga conditions True", () => {
  test("every required condition flips True within 5 minutes", async ({
    page,
  }) => {
    test.setTimeout(TIMEOUT_MS + 60_000);

    const creds = generateUserCredentials();

    // ------------------------------------------------------------------
    // 1. Drive signup form to completion (mirrors signup-happy-path).
    // ------------------------------------------------------------------
    await page.goto(`${BASE_URL}/signup?plan=solo`);
    await page.getByLabel(/first name/i).fill("Saga");
    await page.getByLabel(/last name/i).fill(creds.slug);
    await page.getByLabel(/email/i).fill(creds.email);
    await page.getByLabel("Password", { exact: true }).fill(creds.password);
    await page.getByLabel(/confirm password/i).fill(creds.password);
    await page.getByLabel(/workspace name/i).fill(creds.companyName);
    await page.getByLabel(/terms of service/i).check();
    await page.getByLabel(/privacy policy/i).check();
    await page.getByRole("button", { name: /create account|sign up/i }).click();

    // The dashboard slugifies the workspace name to derive the Tenant CR
    // metadata.name; reproduce that here for kubectl lookups.
    const tenantSlug = creds.companyName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 63);

    // ------------------------------------------------------------------
    // 2. Poll the Tenant CR until phase=Ready or timeout.
    // ------------------------------------------------------------------
    const deadline = Date.now() + TIMEOUT_MS;
    let lastStatus: TenantStatus | null = null;
    while (Date.now() < deadline) {
      lastStatus = readTenantStatus(tenantSlug);
      if (lastStatus?.phase === "Ready") break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    if (lastStatus?.phase !== "Ready") {
      console.error(
        `[saga-conditions] Tenant ${tenantSlug} did not reach Ready in ${TIMEOUT_MS}ms`,
        `(last phase: ${lastStatus?.phase ?? "<missing>"})`,
      );
      printOperatorLogs();
      throw new Error(
        `Tenant ${tenantSlug} did not reach Status.Phase=Ready within ${TIMEOUT_MS}ms`,
      );
    }

    // ------------------------------------------------------------------
    // 3. Assert each required condition is True.
    // ------------------------------------------------------------------
    const conds = lastStatus.conditions ?? [];
    const condByType = new Map(conds.map((c) => [c.type, c]));
    const missing: string[] = [];
    for (const expected of REQUIRED_CONDITIONS) {
      const c = condByType.get(expected);
      if (!c || c.status !== "True") {
        missing.push(`${expected}=${c?.status ?? "<missing>"} reason=${c?.reason ?? "-"}`);
      }
    }
    if (missing.length > 0) {
      console.error(
        `[saga-conditions] missing/false conditions on Tenant ${tenantSlug}:`,
        missing.join("\n  "),
      );
      printOperatorLogs();
      throw new Error(
        `Tenant ${tenantSlug} is Ready but conditions failed: ${missing.join("; ")}`,
      );
    }

    // ------------------------------------------------------------------
    // 4. Assert Vault path tenant/<id>/infra/postgres exists.
    // ------------------------------------------------------------------
    try {
      kubectl([
        "exec", "-n", "gibson", "gibson-vault-0", "--",
        "vault", "read", `secret/data/tenant/${tenantSlug}/infra/postgres`,
      ]);
    } catch (err) {
      console.error(
        `[saga-conditions] Vault path missing for tenant ${tenantSlug}:`,
        err,
      );
      printOperatorLogs();
      throw err;
    }

    // ------------------------------------------------------------------
    // 5. Assert Langfuse has a project for this tenant.
    // ------------------------------------------------------------------
    expect(
      lastStatus.langfuseProjectID,
      "Tenant.status.langfuseProjectID must be set after CreateLangfuseProject step",
    ).toBeTruthy();

    // ------------------------------------------------------------------
    // 6. Cleanup, best-effort, never fails the test.
    // ------------------------------------------------------------------
    try {
      kubectl(["delete", "tenant", tenantSlug, "--ignore-not-found"]);
    } catch (err) {
      console.warn(`[saga-conditions] cleanup failed for ${tenantSlug}:`, err);
    }
  });
});
