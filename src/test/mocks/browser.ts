// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/**
 * MSW worker for browser environment (Playwright, development)
 * This sets up request interception in the browser
 */
export const worker = setupWorker(...handlers);
