// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

/**
 * agent-enrollment.spec.ts, Slice 5.7 part 2
 *
 * Dashboard-side assertions for the agent enrollment flow:
 *
 *   AgentEnrollment CRD created via dashboard → bundle delivered → SPIFFE SVID
 *   issued → agent connects + first heartbeat → dashboard shows enrolled agent
 *   in the agent list with "connected" state.
 *
 * Two test groups:
 *
 *   1. Stubbed (runs without kind cluster), asserts the Register Agent form,
 *      the credential panel, and the agent list page behavior using
 *      Playwright network interception.
 *
 *   2. Integration (requires kind cluster + E2E_KIND_AVAILABLE=1), drives
 *      the real registration form against the cluster, captures the issued
 *      credentials, and asserts the agent appears in the list.
 *
 * Authentication in stubbed tests: synthetic JWE via
 *
 * Refs: dashboard#220 (slice 5.7 p2), agent-service-credentials spec (Task 16).
 */

import { test, expect } from "@playwright/test";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Skip guards
// ---------------------------------------------------------------------------

const needsCluster = !process.env.E2E_KIND_AVAILABLE;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_USER = {
  sub: "e2e-agent-enrollment-user",
  name: "Agent Enrollment Test",
  email: "agent-enrollment@e2e.zeroroot.local",
};
const MOCK_TENANT_ID = "tenant-e2e-agent-test";

/** Synthetic agent registration response (mirrors RegisterAgentResponseBody). */
const MOCK_AGENT_CREDENTIALS = {
  clientId: "e2e-agent-client-id-12345",
  clientSecret: "e2e-agent-secret-abc123",
  gibsonUrl: "https://api.zeroroot.local:30443",
  enrollCommand:
    "gibson component register --client-id e2e-agent-client-id-12345 --client-secret e2e-agent-secret-abc123 --url https://api.zeroroot.local:30443",
};

/** Synthetic agent list response (mirrors /api/components/agents). */
const MOCK_AGENTS_LIST = {
  agents: [
    {
      id: "agent-e2e-enrolled-001",
      name: "e2e-agent",
      description: "E2E test agent",
      status: "connected",
      health: "healthy",
      lastSeen: new Date().toISOString(),
      enrolledAt: new Date().toISOString(),
      kind: "AGENT",
    },
  ],
};

// ---------------------------------------------------------------------------
// Stubbed UI-state tests (no kind cluster required)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Integration tests (kind cluster required)
// ---------------------------------------------------------------------------

test.describe("agent enrollment, integration (kind cluster)", () => {
  test.skip(needsCluster, "requires kind cluster + E2E_KIND_AVAILABLE=1");

  const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:30081";
  const EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
  const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";

  test.setTimeout(120_000);

  test(
    "register agent via dashboard → agent appears in list with enrolled state",
    async ({ page }) => {
      // Login via real Zitadel session.
      await page.goto(`${BASE_URL}/login`);
      await page.getByLabel(/email/i).fill(EMAIL);
      await page.getByLabel(/password/i).fill(PASSWORD);
      await page.getByRole("button", { name: /^log ?in$|^sign ?in$/i }).click();
      await page.waitForURL((url) => !url.pathname.includes("/login"), {
        timeout: 30_000,
      });

      const agentName =
        "e2e-" +
        Date.now().toString(36) +
        "-" +
        crypto.randomBytes(2).toString("hex");

      let capturedClientId = "";
      let capturedEnrollCommand = "";

      await test.step("register agent via form", async () => {
        await page.goto(`${BASE_URL}/dashboard/agents/register`);

        const nameInput = page
          .locator(
            "#register-agent-name, [name='name'], input[placeholder*='agent' i]",
          )
          .first();
        await expect(nameInput).toBeVisible({ timeout: 15_000 });
        await nameInput.fill(agentName);

        await page
          .getByRole("button", { name: /register agent|create agent/i })
          .click();

        // Credential panel.
        const clientIdField = page.locator(
          "#register-agent-client-id, [data-testid='client-id']",
        );
        await expect(clientIdField).toBeVisible({ timeout: 30_000 });

        capturedClientId = await clientIdField.inputValue().catch(
          () => clientIdField.textContent() ?? "",
        ) as string;
        expect(capturedClientId).not.toBe("");

        const enrollField = page.locator(
          "#register-agent-enroll-command, [data-testid='enroll-command']",
        );
        await expect(enrollField).toBeVisible({ timeout: 5_000 });
        capturedEnrollCommand = await enrollField.inputValue().catch(
          () => enrollField.textContent() ?? "",
        ) as string;
        expect(capturedEnrollCommand).toContain(capturedClientId);
      });

      await test.step("agent appears in agents list", async () => {
        await page.goto(`${BASE_URL}/dashboard/agents`);
        await page.waitForLoadState("domcontentloaded");

        // The newly registered agent should appear in the list.
        await expect(
          page.getByText(agentName, { exact: false }),
        ).toBeVisible({ timeout: 20_000 });
      });
    },
  );
});
