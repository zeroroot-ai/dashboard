# Gibson Dashboard

The web UI for the Gibson platform. Operators use it to manage tenants,
launch missions, browse findings, run admin RPCs, and watch the live
event graph. Identities live in Zitadel; authorisation is enforced by
the daemon's ext-authz layer; the dashboard never opens a direct gRPC
channel to the daemon.

## Stack

- **Next.js 16 / React 19**, App Router, TypeScript everywhere.
- **pnpm** for package management.
- **Auth.js v5** with Zitadel as the upstream IdP.
- **ConnectRPC** over **SPIFFE mTLS**, fronted by Envoy + ext-authz.
- **Vitest** for unit tests, **Playwright** for end-to-end tests.

## Prerequisites

- Node.js 20.x or newer.
- pnpm 10.x (`corepack enable && corepack prepare pnpm@10 --activate`).
- A local kind cluster from `enterprise/deploy/helm/gibson/` for any
  workflow that talks to the daemon (most of them).
- Sibling checkouts of `core/gibson/` and `core/sdk/` if you intend to
  regenerate proto bindings (`pnpm proto:generate`).

## Clone

```bash
git clone https://github.com/zero-day-ai/dashboard.git
cd dashboard
pnpm install
```

## Common commands

```bash
pnpm dev            # dev server on :3000
pnpm build          # full production build (runs prebuild policy guards)
pnpm test           # vitest unit tests
pnpm test:e2e       # playwright suite
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm proto:generate # regenerate src/gen/ TS proto bindings (workstation-only)
```

`pnpm prebuild` runs a chain of policy-guard scripts (no direct daemon
gRPC, no legacy auth artefacts, RBAC minimality, authz-registry
freshness, etc.). Do not disable them — fix the underlying code.

## Architecture

This repo is one piece of the wider Gibson platform polyrepo. For the
authoritative platform-wide overview see
`enterprise/docs/ARCHITECTURE.md` in the workspace. For dashboard-only
conventions see [`CLAUDE.md`](./CLAUDE.md), which covers:

- The Auth.js / Zitadel surface and the post-Better-Auth migration.
- The `useAuthorize` / `assertAuthorized` two-layer authz pattern.
- Proto regeneration into `src/gen/`.
- The canonical structured logger at `src/lib/logger.ts`.
- The Envoy + ext-authz daemon path and the `check-no-direct-daemon-grpc`
  guard.

## Repository

`https://github.com/zero-day-ai/dashboard`
