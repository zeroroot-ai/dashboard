// SPDX-License-Identifier: Elastic-2.0
// Copyright 2026 Zero Root AI

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// dashboard#814 (E9): the ConnectRPC daemon transport is owned by ONE
// module-private file, `src/lib/gibson-client/transport.ts`. No other file may
// import the transport package or the channel-construction primitives. Callers
// get typed daemon clients only through the `userClient` / `serviceClient` /
// `bootstrapClient` wrappers. This keeps a single audited boundary for every
// dashboard to daemon call (Envoy URL, SPIFFE mTLS, identity headers). The
// build-time guard `scripts/check-single-daemon-transport.mjs` enforces the
// same rule in `pnpm prebuild`, so the boundary holds where ESLint does not run.
const TRANSPORT_MESSAGE =
  "Do not construct a daemon transport. Import userClient / serviceClient / bootstrapClient from @/src/lib/gibson-client (transport lives only in src/lib/gibson-client/transport.ts).";

export default defineConfig([
  // `next/typescript` registers @typescript-eslint/{parser,eslint-plugin}, so
  // rule names such as `@typescript-eslint/no-explicit-any` in
  // eslint-disable comments resolve (dashboard#198).
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "warn",
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "@connectrpc/connect-node", message: TRANSPORT_MESSAGE }],
          patterns: [{ group: ["@connectrpc/connect-web"], message: TRANSPORT_MESSAGE }],
        },
      ],
    },
  },
  {
    // The single module that owns the ConnectRPC daemon transport. It is the
    // only place that may import @connectrpc/connect-node and call
    // createGrpcTransport / createClient.
    files: ["src/lib/gibson-client/transport.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  // ESLint lints the TypeScript sources only, as `--ext .ts,.tsx` did before.
  // `**/.*` keeps the eslintrc default that skipped every dot file and dot
  // directory, such as `.org-dot-github/` that CI checks out and `.worktrees/`.
  //
  // eslint-plugin-react-hooks 7 adds React Compiler rules that find 88 sites
  // in 54 files. These rules stay errors for new code. The known sites are in
  // eslint-suppressions.json until dashboard#315 fixes them.
  globalIgnores([
    "**/.*",
    "node_modules/",
    ".next/",
    "out/",
    "src/gen/",
    "public/",
    ".worktrees/",
    "**/*.js",
    "**/*.cjs",
    "**/*.mjs",
    "**/*.jsx",
    "*.config.ts",
    "next-env.d.ts",
  ]),
]);
