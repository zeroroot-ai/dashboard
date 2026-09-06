// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/**
 * MSW server for Node.js environment (Vitest)
 * This sets up request interception for all API calls in tests
 */
export const server = setupServer(...handlers);
