import type { NextConfig } from "next";

// The dashboard owns a baseline Content-Security-Policy (dashboard#863).
//
// History: a nonce-based per-request CSP used to live in middleware.ts and was
// removed in the zitadel-envoy-gateway-migration on the assumption the Envoy
// edge would emit one. The app then shipped with NO CSP on any response. That
// assumption is not a control: the edge policy is a different repo's
// configuration, it does not apply to a self-hosted install fronted by some
// other ingress, and it does not apply at all when a response is served
// without traversing the intended vhost. This app renders LLM output and
// attacker-influenced target data, so the app must carry its own policy.
//
// Nonce vs. static: a nonce policy needs a per-request value, which means
// middleware, which does not run on every response (the matcher excludes
// _next/static, api/auth, api/health, api/signup). A static policy in
// `headers()` covers EVERY response, which is the property that matters for a
// baseline. The cost is `'unsafe-inline'` in script-src, because Next.js
// injects inline bootstrap/flight scripts that a static policy cannot
// enumerate. That is a real limitation and is called out below, but the
// directives that actually bound an XSS blast radius — connect-src, img-src,
// form-action, base-uri, object-src, frame-ancestors — are unaffected by
// 'unsafe-inline' and are strict here.
//
// HSTS is a REAL-CERT concern. Emitting it behind the self-signed dev edge
// (kind / self-hosted before a trusted cert is installed) is self-defeating:
// the browser pins the domain (max-age 1y, includeSubDomains) and then refuses
// the self-signed cert with no "proceed" bypass — bricking *.<domain> locally
// (introduced by #865; this gate restores the prior dev behaviour). Deployments
// behind a trusted cert (SaaS, or a self-hosted customer with a real cert) leave
// DASHBOARD_HSTS_DISABLED unset and keep HSTS; kind/self-hosted-self-signed sets
// DASHBOARD_HSTS_DISABLED=1. Default = HSTS ON (prod stays strict).
const hstsDisabled = process.env.DASHBOARD_HSTS_DISABLED === "1";

// `next dev` (Turbopack HMR + React refresh) evaluates transpiled modules with
// eval(). Production never needs it. This is the only dev/prod divergence in the
// policy and it relaxes dev only, so the production build stays the strict one.
const isDev = process.env.NODE_ENV !== "production";

// Third-party origins the BROWSER genuinely reaches. Each entry is justified;
// anything not listed is denied by the `default-src 'self'` fallback.
//
//   js.stripe.com / hooks.stripe.com / m.stripe.network , Stripe.js + the
//     Payment Element iframes used by card-first signup and the billing
//     settings page (@stripe/react-stripe-js injects the script at runtime).
//   api.stripe.com / r.stripe.com , Stripe.js XHR + error telemetry.
//   challenges.cloudflare.com / *.hcaptcha.com , the Turnstile / hCaptcha
//     widget scripts and frames. Selected by DASHBOARD_CAPTCHA_PROVIDER; the
//     default is "disabled", so these are usually unused. Listing them costs
//     nothing and keeps a provider flip from silently breaking signup.
//   googletagmanager.com / google-analytics.com , react-ga4 (lib/ga.ts) injects
//     the gtag script at runtime when NEXT_PUBLIC_GA_KEY is set.
//   avatars.githubusercontent.com / lh3.googleusercontent.com , social-login
//     avatars; these already appear in `images.remotePatterns` below.
//
// NOT listed on purpose: the Monaco editor is bundled locally
// (`loader.config({ monaco: monacoEditor })` in MissionCUEEditor.tsx), so no
// CDN origin is required. HIBP and the captcha siteverify calls are
// server-side only.
const STRIPE_SCRIPT = "https://js.stripe.com";
const STRIPE_FRAMES = "https://js.stripe.com https://hooks.stripe.com https://m.stripe.network";
const STRIPE_CONNECT = "https://api.stripe.com https://m.stripe.network https://r.stripe.com";
const CAPTCHA = "https://challenges.cloudflare.com https://*.hcaptcha.com";
const ANALYTICS_SCRIPT = "https://www.googletagmanager.com";
const ANALYTICS_CONNECT =
  "https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com";

/**
 * The dashboard's baseline Content-Security-Policy.
 *
 * Exported as a single named constant so the CI guard (scripts/check-csp.mjs)
 * has a stable thing to assert on rather than having to parse the header array.
 *
 * Directive notes:
 *   default-src 'self'      , deny-by-default for every fetch type not named below.
 *   base-uri 'none'         , kills <base href> injection outright. Nothing in
 *                             this app sets a base tag, so 'none' is safe and is
 *                             strictly stronger than 'self'. Unaffected by
 *                             'unsafe-inline' in script-src, which is why it is
 *                             one of the directives that still earns its keep.
 *   object-src 'none'       , no <object>/<embed>/<applet> plugin content.
 *   frame-ancestors 'none'  , clickjacking; the modern replacement for the
 *                             X-Frame-Options: DENY header kept alongside it.
 *   form-action 'self'      , a form injected into LLM-rendered output cannot
 *                             POST credentials or findings to an attacker host.
 *   script-src              , see the 'unsafe-inline' caveat above the HSTS
 *                             comment. External script ORIGINS are still
 *                             restricted, so an injected
 *                             <script src="https://evil/..."> is blocked.
 *   style-src 'unsafe-inline', Tailwind/CSS-in-JS, Monaco, mermaid and xterm all
 *                             write inline style attributes. Inline style is not
 *                             a script-execution primitive.
 *   img-src data: blob:     , generated diagrams, canvas exports, avatars.
 *   connect-src             , the exfiltration-relevant directive. Same-origin
 *                             plus the third parties above; 'self' also covers
 *                             same-origin ws/wss for the terminal + event stream.
 *   worker-src 'self' blob: , Monaco language workers and mermaid render workers
 *                             are instantiated from blob URLs.
 *
 * Deliberately absent: `upgrade-insecure-requests`, which would break plain-http
 * local dev, and `require-trusted-types-for`, which needs a policy audit of
 * every DOM sink first.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} ${STRIPE_SCRIPT} ${CAPTCHA} ${ANALYTICS_SCRIPT}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://avatars.githubusercontent.com https://lh3.googleusercontent.com https://www.googletagmanager.com https://*.google-analytics.com",
  "font-src 'self' data:",
  `connect-src 'self' ${STRIPE_CONNECT} ${CAPTCHA} ${ANALYTICS_CONNECT}`,
  `frame-src 'self' ${STRIPE_FRAMES} ${CAPTCHA}`,
  "worker-src 'self' blob:",
  "media-src 'self' data: blob:",
  "manifest-src 'self'",
].join("; ");

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: CONTENT_SECURITY_POLICY,
  },
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
    // `remotePatterns` is an allowlist for the /_next/image optimiser: any
    // origin listed here can be fetched by the server on behalf of an
    // unauthenticated caller who controls the `url` query parameter. The
    // `http` + `localhost` entry carried no port, so it allowed every port on
    // the loopback interface of whichever machine ran the server. That is
    // useful when the machine is a laptop and harmful when it is a pod. Keep
    // it for local development only; a production build has no legitimate
    // loopback image source.
    remotePatterns: [
      ...(process.env.NODE_ENV === "production"
        ? []
        : [
            {
              protocol: "http" as const,
              hostname: "localhost",
            },
          ]),
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
  // NO rewrites. There used to be a `/api/grpc/:path*` →
  // `${GIBSON_API_URL}/:path*` rewrite here, ungated by environment, which made
  // the Next.js server a browser-reachable reverse proxy onto the daemon front
  // door. Every authorization decision in this product is taken by Envoy +
  // ext_authz on the request path; a Next.js rewrite is a different request
  // path, so anything reaching the daemon through it arrived without that
  // decision having been made. The rewrite had NO callers anywhere in this repo
  // (`rg "api/grpc"` matched only the rewrite itself and one env-var comment),
  // so it is deleted outright rather than dev-gated: a dev-gated version is
  // still a codepath that only differs by environment, which is exactly the
  // divergence ADR-0027 forbids.
  //
  // Server-side daemon calls go through src/lib/gibson-client.ts
  // (userClient / serviceClient) at the Envoy base URL. Do not re-add a rewrite,
  // a route handler that forwards opaquely, or any other pass-through onto the
  // daemon. See the `check-no-direct-daemon-grpc.mjs` prebuild guard.
  async redirects() {
    return [
      // The agent console moved to /dashboard/sandboxes (dashboard#1159). The
      // query string carries the deep link (?run=<id>) and Next keeps it.
      {
        source: "/dashboard/agents/console",
        destination: "/dashboard/sandboxes",
        permanent: true,
      },
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

// No MDX adapter. The customer docs moved to their own deployable
// (dashboard#820); the only .mdx left in this app is under
// app/dashboard/(auth)/docs, which is read with readFileSync and rendered
// by react-markdown at request time, not compiled by a bundler plugin.
export default nextConfig;
