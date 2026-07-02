import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, afterAll, vi } from 'vitest';
import { server } from './mocks/server';

// jsdom doesn't implement ResizeObserver, which Radix primitives (Slider,
// Select, …) instantiate on mount. Provide a no-op so component tests that
// render those primitives don't throw.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

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

// Mock Auth.js client
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

// Mock environment variables. auth.ts (loaded transitively by any test that
// touches @/auth or @/src/lib/auth) calls requireEnv() at module-eval time
// on ZITADEL_* values and throws if they're missing. The dashboard intentionally
// has no Zitadel-optional degradation surface (deploy#196), so the only way to
// load the module under test is to provide placeholder values via env. The
// values are never used, every test mocks @/src/lib/auth so the auth chain
// never actually executes, but the import-time validation needs them present.
// dashboard#175.
process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3000';
process.env.ZITADEL_ISSUER ??= 'http://test.zitadel.invalid';
process.env.ZITADEL_CLIENT_ID ??= 'test-client-id';
process.env.ZITADEL_CLIENT_SECRET ??= 'test-client-secret';
process.env.AUTH_SECRET ??= 'test-auth-secret-32-bytes-of-padding-aaaa';
process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY ??=
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
