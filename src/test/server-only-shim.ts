// Empty shim for Next.js `server-only` used only by vitest. The real
// package exists at build time and throws if imported into a client
// bundle; under vitest we run under Node with no SSR boundary, so the
// guard has nothing to assert.
export {};
