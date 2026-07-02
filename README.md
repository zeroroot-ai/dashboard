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
git clone https://github.com/zeroroot-ai/dashboard.git
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
freshness, etc.). Do not disable them, fix the underlying code.

## Standalone build (outside the polyrepo workspace)

A bare `pnpm build` runs the prebuild chain, which includes generators
(`gen-plans.mjs`, `gen-stripe-tiers.mjs`, `gen-authz-registry.mjs`) that
read sibling private repos in the canonical `~/Code/zeroroot.ai/`
workspace. Those siblings are not present in a standalone checkout, so
the generators cannot run there. The committed generated files
(`src/generated/plans.ts`, `src/lib/billing/stripe_gen.ts`,
`src/gen/authz/registry.ts`) are the source of truth at build time, and
the official image build (see `Dockerfile`) trusts them by setting the
skip envs below. External contributors building outside the workspace
must set the same envs:

```bash
SKIP_GEN_PLANS=1 \
SKIP_PLANS_FRESH_CHECK=1 \
SKIP_GEN_STRIPE_TIERS=1 \
SKIP_STRIPE_TIERS_FRESH_CHECK=1 \
SKIP_GEN_AUTHZ_REGISTRY=1 \
SKIP_AUTHZ_REGISTRY_CHECK=1 \
SKIP_DASHBOARD_RBAC_CHECK=1 \
  pnpm build
```

These are exactly the envs the `Dockerfile` builder stage sets; keep the
two lists in sync. The `*_FRESH_CHECK` / `*_CHECK` variants skip the
workstation-only drift gates that diff the committed files against the
private siblings (which a standalone checkout cannot reach), while
`SKIP_DASHBOARD_RBAC_CHECK` skips the `helm template` RBAC diff that
needs a Helm binary. The drift gates still run in the full workspace via
`pnpm prebuild`, keeping the committed generated files honest.

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

`https://github.com/zeroroot-ai/dashboard`

## License

This project is licensed under the Elastic License 2.0. See the
[`LICENSE`](./LICENSE) file for the full text.
