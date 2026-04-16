import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, afterAll, vi } from 'vitest';
import { server } from './mocks/server';

// Establish API mocking before all tests
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

// Reset any request handlers that we may add during the tests,
// so they don't affect other tests
afterEach(() => {
  server.resetHandlers();
  cleanup();
});

// Clean up after the tests are finished
afterAll(() => {
  server.close();
});

// Mock Next.js router
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

// Mock Better Auth client
vi.mock('@/src/lib/auth-client', () => ({
  authClient: {
    useSession: () => ({
      data: {
        user: {
          name: 'Test User',
          email: 'test@example.com',
        },
        session: {
          tenantId: 'test-tenant',
        },
      },
      isPending: false,
    }),
    signIn: { email: vi.fn() },
    signOut: vi.fn(),
    organization: {
      create: vi.fn(),
      list: vi.fn(),
    },
  },
}));

// Mock server-only marker so that Server-Action modules can be imported
// under test. Production code still enforces server-only at build time via
// Next.js's own handling; vitest runs under Node with no SSR boundary.
vi.mock('server-only', () => ({}));

// Mock environment variables
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3000';
