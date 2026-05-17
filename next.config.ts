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
    // GIBSON_API_URL is REQUIRED at SERVER START — see src/lib/env-validator.ts.
    //
    // next.config.ts is evaluated by `next build` AT BUILD TIME and AGAIN
    // when the Next.js Node server starts. The image build runs without
    // any pod-side env (the chart wires GIBSON_API_URL at pod-start, not
    // at docker-build), so a hard throw here would fail the image build.
    //
    // The required-env fence lives at boot in validateEnv() (run from
    // instrumentation.register()) which DOES crashloop a misconfigured
    // pod. next.config.ts here uses a clearly-synthetic stub URL when
    // the env is missing during build; runtime missing-env is caught one
    // tick later by validateEnv() before any request can succeed.
    const gibsonApiUrl =
      process.env.GIBSON_API_URL ?? "http://__BUILD_TIME_STUB_GIBSON_API_URL__";
    return [
      {
        source: "/api/grpc/:path*",
        destination: `${gibsonApiUrl}/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      // /dashboard/users → /dashboard/organization/users (users moved into Organization group; dashboard#144).
      {
        source: "/dashboard/users",
        destination: "/dashboard/organization/users",
        permanent: true,
      },
      {
        source: "/dashboard/users/:userId",
        destination: "/dashboard/organization/users/:userId",
        permanent: true,
      },
      // Old org pages lived in the `(dashboard)` segment group, which Next.js
      // resolves at the root (/pages/...) — never under /dashboard. Redirect
      // both the "what the sidebar pointed at" form and the "what actually
      // resolved" form to the new canonical location.
      {
        source: "/dashboard/pages/settings/organization/teams",
        destination: "/dashboard/organization/teams",
        permanent: true,
      },
      {
        source: "/dashboard/pages/settings/organization/security-policy",
        destination: "/dashboard/organization/security-policy",
        permanent: true,
      },
      {
        source: "/pages/settings/organization/teams",
        destination: "/dashboard/organization/teams",
        permanent: true,
      },
      {
        source: "/pages/settings/organization/security-policy",
        destination: "/dashboard/organization/security-policy",
        permanent: true,
      },
      // /dashboard/settings/billing and /dashboard/billing/upgrade were
      // duplicates of /dashboard/pages/settings/billing (dashboard#147).
      // Send the legacy URLs to the canonical location so external links
      // (Stripe portal return URLs, billing emails, bookmarks) keep working.
      {
        source: "/dashboard/settings/billing",
        destination: "/dashboard/pages/settings/billing",
        permanent: true,
      },
      {
        source: "/dashboard/billing/upgrade",
        destination: "/dashboard/pages/settings/billing",
        permanent: true,
      },
      // The pre-Zitadel signup flows at /dashboard/register/v1 and v2
      // were retired when Auth.js took over signup at /signup. Direct
      // any stragglers to the live signup page.
      {
        source: "/dashboard/register/v1",
        destination: "/signup",
        permanent: true,
      },
      {
        source: "/dashboard/register/v2",
        destination: "/signup",
        permanent: true,
      },
    ];
  },
};

// Wrap with Fumadocs MDX adapter so `.mdx` content under `content/docs/`
// is compiled at build time. The adapter reads `source.config.ts` and
// emits typed output to `.source/` (gitignored).
const withMDX = createMDX();

export default withMDX(nextConfig);
