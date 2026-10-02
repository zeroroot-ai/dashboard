// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the e2e suite.
 *
 * The suite runs against a live product host, staging by default
 * (.github/workflows/e2e-staging.yml, on push to main and daily, never on a
 * pull request). There is no dev server here: every spec signs in through
 * Zitadel the way a person does, and that needs the real platform behind
 * the host. See e2e/README.md.
 */
export default defineConfig({
  testDir: './e2e',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* One worker on CI: Zitadel refuses a reused TOTP code, so two sign-ins of
   * the same account inside one 30 second window would collide. */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use. The JSON file feeds e2e/skip-floor.mjs. */
  reporter: [
    ['html'],
    ['list'],
    ['json', { outputFile: 'playwright-report/test-results.json' }],
  ],

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')` */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',

    /* The product host serves a real certificate. A self-signed chain is a
     * failure, not something to ignore. */
    ignoreHTTPSErrors: false,

    /* Collect trace when retrying the failed test */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video on failure */
    video: 'retain-on-failure',
  },

  /* One browser. The hosted exit tests drive the same Login v2 pages with
   * Chromium, and a second engine would double the sign-ins against staging
   * without adding signal. */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
