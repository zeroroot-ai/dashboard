/** @type {import('eslint').Linter.Config} */
module.exports = {
  // `next/typescript` registers @typescript-eslint/{parser,eslint-plugin}
  // so rule references like `@typescript-eslint/no-explicit-any` (in
  // eslint-disable comments and individual file overrides) resolve. Without
  // it, those rule names trip "Definition for rule … was not found" errors
  // even though the parser is set up. See dashboard#198.
  extends: ["next/core-web-vitals", "next/typescript"],
  rules: {
    "react/no-unescaped-entities": "off",
    "@next/next/no-img-element": "warn",
    // dashboard#814 (E9): the ConnectRPC daemon transport is owned by ONE
    // module-private file, `src/lib/gibson-client/transport.ts`. No other
    // file may import the transport package or the channel-construction
    // primitives, callers obtain typed daemon clients exclusively through the
    // sanctioned `userClient` / `serviceClient` / `bootstrapClient` wrappers.
    // This keeps a single audited boundary for every dashboard→daemon call
    // (Envoy URL + SPIFFE mTLS + identity headers). The transport file itself
    // is exempted via an override below. The build-time guard
    // `scripts/check-single-daemon-transport.mjs` enforces the same rule in
    // `pnpm prebuild` so the boundary holds even where ESLint does not run.
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@connectrpc/connect-node",
            message:
              "Do not construct a daemon transport. Import userClient / serviceClient / bootstrapClient from @/src/lib/gibson-client (transport lives only in src/lib/gibson-client/transport.ts).",
          },
        ],
        patterns: [
          {
            group: ["@connectrpc/connect-web"],
            message:
              "Do not construct a daemon transport. Import userClient / serviceClient / bootstrapClient from @/src/lib/gibson-client (transport lives only in src/lib/gibson-client/transport.ts).",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // The single module that owns the ConnectRPC daemon transport. It is the
      // ONLY place permitted to import @connectrpc/connect-node and call
      // createGrpcTransport / createClient.
      files: ["src/lib/gibson-client/transport.ts"],
      rules: {
        "no-restricted-imports": "off",
      },
    },
  ],
};
