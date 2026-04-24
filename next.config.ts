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
  experimental: {
    // Persist the Server Action encryption key across builds so already-loaded
    // browser bundles can still POST to actions after a deployment. Without
    // this, every dashboard rebuild rotates action IDs and any client tab
    // open across the deploy throws "Failed to find Server Action" → the user
    // sees "Something went wrong on our end" until they hard-refresh.
    //
    // Mounted via the Helm chart from the gibson-dashboard secret (key
    // NEXT_SERVER_ACTIONS_ENCRYPTION_KEY). Falls back to a per-build key in
    // dev so local `npm run dev` still works without secret plumbing.
    serverActions: {
      ...(process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
        ? { encryptionKey: process.env.NEXT_SERVER_ACTIONS_ENCRYPTION_KEY }
        : {}),
    },
  },
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
