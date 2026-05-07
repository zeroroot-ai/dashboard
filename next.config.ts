import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

// CSP is now nonce-based and set per-request in middleware.ts.
// Only non-CSP security headers remain here (static, same for every response).
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Tell Next.js not to bundle these Node-only server packages — they use
  // `node:http2` / `node:fs` and blow up Turbopack's module analyzer otherwise.
  // @grpc/grpc-js added here because the SPIFFE workload-api client (server-only)
  // pulls in native Node.js modules that Turbopack cannot resolve in a browser
  // or Edge bundle. Spec: signup-zitadel-permissions-fix (Docker build fix).
  serverExternalPackages: [
    "@connectrpc/connect-node",
    "@connectrpc/connect",
    "@grpc/grpc-js",
    // prom-client uses Node-only modules (cluster, fs, v8). With Turbopack
    // module-graph tracing in Next.js 16, statically including it from the
    // metrics route + middleware fails to resolve those Node primitives in
    // the Edge bundle context. Marking it external defers resolution to
    // Node runtime where the modules are available natively.
    "prom-client",
    // pino + transport stack: pino-pretty / thread-stream / pino-abstract-transport
    // ship test files (*.test.js) and ESLint configs that import dev-only
    // packages (`neostandard`, `pino-elasticsearch`). Next.js 16's Turbopack
    // tracer follows ALL `require()` sites in the package — including those
    // in test/eslint files — and fails to resolve them. Marking the entire
    // pino transport graph as external defers their resolution to Node at
    // runtime (where the test/eslint files are never required by pino itself).
    "pino",
    "pino-pretty",
    "thread-stream",
    "pino-abstract-transport",
    "pino-std-serializers",
    "sonic-boom",
  ],
  // Server Action encryption key persistence is env-driven in Next.js 16:
  // setting NEXT_SERVER_ACTIONS_ENCRYPTION_KEY in the runtime environment
  // is enough — no config wiring required. The Helm chart mounts the env
  // var from the dashboard secret (auto-generated on first install,
  // preserved across upgrades) so action IDs stay stable across rebuilds.
  // Without this, every dashboard rebuild rotates action IDs and any browser
  // tab loaded BEFORE the rebuild fails its next form submit with "Failed
  // to find Server Action" → user-facing "Something went wrong on our end".
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/grpc/:path*",
        destination: `${process.env.GIBSON_API_URL || "http://localhost:50002"}/:path*`,
      },
    ];
  },
};

// Wrap with Fumadocs MDX adapter so `.mdx` content under `content/docs/`
// is compiled at build time. The adapter reads `source.config.ts` and
// emits typed output to `.source/` (gitignored).
const withMDX = createMDX();

export default withMDX(nextConfig);
