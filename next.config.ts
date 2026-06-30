import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

// CSP is NOT emitted by the dashboard app. The nonce-based per-request CSP that
// used to live in middleware.ts was removed in the zitadel-envoy-gateway-migration
// (CSP moved to the Envoy edge). The static non-CSP security headers below remain
// here, same for every response. dashboard#818 verified no CSP is set by app code
// and filed dashboard#863 to confirm the edge actually emits one (and to decide
// whether the app should own a baseline CSP as defense-in-depth).
// HSTS is a REAL-CERT concern. Emitting it behind the self-signed dev edge
// (kind / self-hosted before a trusted cert is installed) is self-defeating:
// the browser pins the domain (max-age 1y, includeSubDomains) and then refuses
// the self-signed cert with no "proceed" bypass — bricking *.<domain> locally
// (introduced by #865; this gate restores the prior dev behaviour). Deployments
// behind a trusted cert (SaaS, or a self-hosted customer with a real cert) leave
// DASHBOARD_HSTS_DISABLED unset and keep HSTS; kind/self-hosted-self-signed sets
// DASHBOARD_HSTS_DISABLED=1. Default = HSTS ON (prod stays strict).
const hstsDisabled = process.env.DASHBOARD_HSTS_DISABLED === "1";

const securityHeaders = [
  ...(hstsDisabled
    ? []
    : [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
      ]),
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
  // Dev-only (ignored by `next build`): Next.js 16 blocks /_next/* dev
  // resources for origins other than localhost, which silently prevents
  // hydration, client-driven UI (e.g. the landing Typewriter) renders
  // frozen with no console error. Allow the hosts a workstation browser
  // actually uses to reach `next dev`.
  allowedDevOrigins: ["0.0.0.0", "127.0.0.1", "192.168.50.223"],
  // Tell Next.js not to bundle these Node-only server packages, they use
  // `node:http2` / `node:fs` and blow up Turbopack's module analyzer otherwise.
  // @grpc/grpc-js added here because the SPIFFE workload-api client (server-only)
  // pulls in native Node.js modules that Turbopack cannot resolve in a browser
  // or Edge bundle. Spec: signup-zitadel-permissions-fix (Docker build fix).
  serverExternalPackages: [
    // @aws-sdk/client-ses: optional runtime dep for SES email. webpack
    // statically resolves the require() in ses.ts; marking external lets
    // Node's native require() handle it at runtime, where ses.ts's try-catch
    // handles the missing package gracefully. See dashboard#301.
    "@aws-sdk/client-ses",
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
    // tracer follows ALL `require()` sites in the package, including those
    // in test/eslint files, and fails to resolve them. Marking the entire
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
  // is enough, no config wiring required. The Helm chart mounts the env var
  // from the dashboard secret (delivered by External Secrets, preserved across
  // upgrades) so the key is identical across replicas and survives redeploys.
  //
  // What this DOES fix: a stable key keeps the encryption of an action's bound
  // arguments consistent, so multi-replica / rolling deploys don't hit
  // "Failed to decrypt Server Action" when a request lands on a pod that
  // didn't mint the payload.
  //
  // What this does NOT fix: it does NOT freeze Server Action *IDs* across
  // rebuilds. Next.js derives action IDs from the build's module graph, so any
  // code-changing rebuild rotates them. A browser tab loaded from an older
  // build then POSTs an unknown ID and Next throws "Failed to find Server
  // Action … older or newer deployment". That deployment skew is inherent to
  // rolling a Next.js app; the recovery is client-side (reload to fetch the
  // current bundle), see src/lib/server-action-skew.ts. Do not assume this
  // env var alone prevents the "Something went wrong" signup error.
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
    // GIBSON_API_URL is REQUIRED at SERVER START, see src/lib/env-validator.ts.
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
      // resolves at the root (/pages/...), never under /dashboard. Redirect
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
