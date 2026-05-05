/**
 * checkpoint-browser.spec.ts — End-to-end test for the Checkpoint Browser
 * tab on the mission detail page.
 *
 * Covers (mission-checkpointing R17 / week-4-handlers-ui-e2e §4):
 *   - The Checkpoints tab appears when the user has `mission#viewer`.
 *   - Clicking a checkpoint row opens the side panel showing the payload.
 *   - Selecting two checkpoints + clicking "Diff selected" opens the diff
 *     dialog.
 *   - Clicking "Rewind to here" on a non-latest checkpoint opens the
 *     confirmation modal; the Confirm button stays disabled until the
 *     mission ID is typed verbatim.
 *   - Confirming the rewind submits the Resume RPC (verified via mocked
 *     server-action endpoint).
 *
 * The test uses Playwright route-mocks to fake the daemon responses so
 * the suite can run without a live daemon. A live-cluster variant is
 * left to the kind harness invocation (see e2e/README.md).
 */

import { test, expect, type Page } from "@playwright/test";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "password";

const MISSION_ID = "mission-cp-e2e-001";
const MISSION_DETAIL_URL = `${BASE_URL}/dashboard/missions/${MISSION_ID}`;

const NEWER_CP = "ckpt-newer-aaaaaaaa";
const TARGET_CP = "ckpt-target-bbbbbbbb";
const OLDEST_CP = "ckpt-oldest-cccccccc";

async function loginAs(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page
    .getByRole("button", { name: /^log ?in$|^sign ?in$/i })
    .click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 20_000,
  });
}

/**
 * Mock the Server Actions used by the checkpoint browser. Next.js
 * Server Actions POST to the same route as the page; we intercept any
 * POST that targets the mission detail URL and key off the request
 * body to dispatch a fake response.
 */
async function mockCheckpointActions(page: Page) {
  // Mock the FGA membership endpoint so `useAuthorize` for ListCheckpoints
  // returns `allowed: true`.
  await page.route("**/api/auth/my-memberships", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        activeTenantId: "tenant-e2e",
        byTenant: {
          "tenant-e2e": { role: "admin", tenantName: "E2E" },
        },
      }),
    });
  });

  // The Server Action invocations encode the function id and payload in
  // the request body. We do not inspect them exhaustively — instead we
  // pattern-match on URL fragments and the action name string the
  // Next.js bundler embeds. Because this E2E targets the dashboard's
  // Server Action machinery, the mock layer is intentionally permissive.
  await page.route("**/dashboard/missions/**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = route.request().postData() ?? "";

    if (body.includes("listCheckpointsAction")) {
      await route.fulfill({
        status: 200,
        contentType: "text/x-component",
        body: JSON.stringify({
          ok: true,
          response: {
            checkpoints: [
              {
                checkpointId: NEWER_CP,
                missionId: MISSION_ID,
                superStep: "12",
                capturedAt: { seconds: "1714300000", nanos: 0 },
                sizeBytes: "204800",
                source: 1,
                inFlightIdempotency: 0,
                parallelGroupId: "",
              },
              {
                checkpointId: TARGET_CP,
                missionId: MISSION_ID,
                superStep: "10",
                capturedAt: { seconds: "1714200000", nanos: 0 },
                sizeBytes: "180000",
                source: 1,
                inFlightIdempotency: 0,
                parallelGroupId: "",
              },
              {
                checkpointId: OLDEST_CP,
                missionId: MISSION_ID,
                superStep: "5",
                capturedAt: { seconds: "1714100000", nanos: 0 },
                sizeBytes: "100000",
                source: 5,
                inFlightIdempotency: 0,
                parallelGroupId: "",
              },
            ],
            nextPageToken: "",
            totalCount: 3,
          },
        }),
      });
      return;
    }

    if (body.includes("getCheckpointAction")) {
      await route.fulfill({
        status: 200,
        contentType: "text/x-component",
        body: JSON.stringify({
          ok: true,
          response: {
            checkpoint: {
              summary: {
                checkpointId: TARGET_CP,
                missionId: MISSION_ID,
                superStep: "10",
                capturedAt: { seconds: "1714200000", nanos: 0 },
                sizeBytes: "180000",
                source: 1,
                inFlightIdempotency: 0,
              },
              workingMemory: btoa('{"phase":"recon","progress":0.6}'),
              missionMemory: btoa("{}"),
              steps: [],
              findings: [],
              parallelGroups: {},
            },
          },
        }),
      });
      return;
    }

    if (body.includes("diffCheckpointsAction")) {
      await route.fulfill({
        status: 200,
        contentType: "text/x-component",
        body: JSON.stringify({
          ok: true,
          response: {
            diff: {
              workingMemoryDeltas: [
                {
                  key: "phase",
                  op: 3,
                  before: btoa('"recon"'),
                  after: btoa('"exploit"'),
                },
              ],
              missionMemoryDeltas: [],
              dagStepDeltas: [],
              findingDeltas: [],
              parallelGroupDeltas: [],
            },
          },
        }),
      });
      return;
    }

    if (body.includes("resumeMissionAction")) {
      await route.fulfill({
        status: 200,
        contentType: "text/x-component",
        body: JSON.stringify({
          ok: true,
          checkpointMetadata: {
            checkpointId: TARGET_CP,
            savedAtUnixSeconds: "1714200000",
            superStepNumber: 10,
            cadenceReason: "manual",
            sizeBytes: "180000",
          },
        }),
      });
      return;
    }

    await route.continue();
  });

  // Stub out the mission detail GET to return a minimal mission payload.
  await page.route(`**/api/missions/${MISSION_ID}`, async (route) => {
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: MISSION_ID,
        name: "Checkpoint browser E2E",
        status: "paused",
        progress: 60,
        startedAt: new Date(1714000000_000).toISOString(),
        config: { target: "demo", description: "" },
        agents: [],
        findings: 0,
        events: 0,
        tenantId: "tenant-e2e",
      }),
    });
  });
}

test.describe("Checkpoint Browser (mission-checkpointing R17)", () => {
  test.beforeEach(async ({ page }) => {
    await loginAs(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await mockCheckpointActions(page);
  });

  test("Checkpoints tab is visible to a viewer", async ({ page }) => {
    await page.goto(MISSION_DETAIL_URL);
    await expect(
      page.getByRole("tab", { name: /^Checkpoints$/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("clicking a checkpoint row opens the detail side panel", async ({
    page,
  }) => {
    await page.goto(MISSION_DETAIL_URL);
    await page.getByRole("tab", { name: /^Checkpoints$/i }).click();

    await page
      .getByRole("button", { name: /^View$/ })
      .nth(1)
      .click();

    await expect(
      page.getByText(/Checkpoint /, { exact: false }).first(),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Working memory/i)).toBeVisible();
    await expect(page.getByText(/Mission memory/i)).toBeVisible();
  });

  test("selecting two checkpoints and clicking Diff selected opens the diff dialog", async ({
    page,
  }) => {
    await page.goto(MISSION_DETAIL_URL);
    await page.getByRole("tab", { name: /^Checkpoints$/i }).click();

    const checkboxes = page.getByRole("checkbox", {
      name: /Select checkpoint/i,
    });
    await checkboxes.nth(0).check();
    await checkboxes.nth(1).check();

    await page.getByRole("button", { name: /Diff selected/i }).click();

    await expect(page.getByText(/Diff /).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/Working memory/i)).toBeVisible();
    await expect(page.getByText(/Mission memory/i)).toBeVisible();
  });

  test("Rewind to here on a non-latest checkpoint requires typed mission ID", async ({
    page,
  }) => {
    await page.goto(MISSION_DETAIL_URL);
    await page.getByRole("tab", { name: /^Checkpoints$/i }).click();

    // The latest row hides Rewind; the second row exposes it.
    await page
      .getByRole("button", { name: /Rewind to here/i })
      .first()
      .click();

    const confirm = page.getByRole("button", { name: /^Rewind to here$/i });
    await expect(confirm).toBeDisabled();

    await page.getByLabel(/Type the mission ID/i).fill("wrong-id");
    await expect(confirm).toBeDisabled();

    await page.getByLabel(/Type the mission ID/i).fill(MISSION_ID);
    await expect(confirm).toBeEnabled();

    await confirm.click();

    // Toast surface — sonner emits a status region. Be permissive in the
    // matcher because sonner's DOM moves between renders.
    await expect(
      page.getByText(/Rewind started|Resumed from checkpoint/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("a freshly-captured checkpoint event prepends a row to the timeline", async ({
    page,
  }) => {
    // Override the events SSE route so we can inject a single
    // `event: checkpoint` frame and assert the timeline prepends a row.
    // The mock fulfils with a complete SSE payload (no streaming); the
    // browser's EventSource parser handles it the same way.
    const FRESH_CP = "ckpt-fresh-eeeeeeee";

    await page.route(
      `**/api/missions/${MISSION_ID}/events`,
      async (route) => {
        const sse = [
          ": open",
          "",
          "event: checkpoint",
          `data: ${JSON.stringify({
            checkpointId: FRESH_CP,
            missionId: MISSION_ID,
            superStep: "13",
            capturedAt: { seconds: "1714400000", nanos: 0 },
            sizeBytes: "210000",
            source: 1,
            inFlightIdempotency: 0,
            parallelGroupId: "",
          })}`,
          "",
          "",
        ].join("\n");
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
          body: sse,
        });
      },
    );

    await page.goto(MISSION_DETAIL_URL);
    await page.getByRole("tab", { name: /^Checkpoints$/i }).click();

    // The fresh checkpoint should appear as the first row (newest first).
    // We assert by the last 8 chars of the synthetic ID, which the row
    // renders verbatim via the `checkpointShortId` helper.
    const fresh8 = FRESH_CP.slice(-8);
    await expect(page.getByText(fresh8).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
