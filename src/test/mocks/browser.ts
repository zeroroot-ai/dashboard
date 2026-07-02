import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

/**
 * MSW worker for browser environment (Playwright, development)
 * This sets up request interception in the browser
 */
export const worker = setupWorker(...handlers);
