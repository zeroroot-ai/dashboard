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
  serverExternalPackages: [
    "@connectrpc/connect-node",
    "@connectrpc/connect",
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
